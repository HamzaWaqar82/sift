// Emailed one-time links for a forgotten password and for confirming a new email address.
//
// Like invitations, only the SHA-256 of a token is stored. The token is HMAC(SESSION_SECRET,
// purpose:id:nonce), so the mail job rebuilds the link from the row and the plaintext is never
// written to the database or a job payload. Claiming a link is one conditional UPDATE, so it works
// exactly once even under concurrent clicks.
import { createHash, createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { account, accountTokens, users } from "@/lib/db/schema";
import { MAIL_ACCOUNT_LINK } from "@/lib/jobs/kinds/mail-account";
import { enqueueJob } from "@/lib/jobs/queue";
import { appBaseUrl, hashPassword } from "./better-auth";
import { revokeAllSessions } from "./session";

export const RESET_TTL_MS = 60 * 60 * 1000;
export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

export const RESET_INVALID_MESSAGE = "This reset link is no longer valid. Request a new one.";
export const EMAIL_CHANGE_INVALID_MESSAGE = "This confirmation link is no longer valid. Change your email again to get a new one.";

type Purpose = (typeof accountTokens.$inferSelect)["purpose"];
type TokenRow = typeof accountTokens.$inferSelect;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return value;
}

function tokenFor(row: Pick<TokenRow, "id" | "nonce" | "purpose">): string {
  return createHmac("sha256", secret()).update(`${row.purpose}:${row.id}:${row.nonce}`).digest("base64url");
}

/** The emailed link for a token row. */
export function accountLink(row: Pick<TokenRow, "id" | "nonce" | "purpose">): string {
  const path = row.purpose === "password_reset" ? "reset-password" : "confirm-email";
  return `${appBaseUrl()}/${path}/${tokenFor(row)}`;
}

/** Inserts a token row and queues its email in one transaction. */
async function issueToken(userId: number, purpose: Purpose, ttlMs: number, newEmail: string | null): Promise<void> {
  const nonce = randomBytes(16).toString("base64url");
  await getDb().transaction(async (tx) => {
    // The token depends on the row id, so insert with a placeholder hash and fill it in.
    const [row] = await tx
      .insert(accountTokens)
      .values({ userId, purpose, nonce, newEmail, tokenHash: `pending:${nonce}`, expiresAt: new Date(Date.now() + ttlMs) })
      .returning();
    await tx.update(accountTokens).set({ tokenHash: sha256(tokenFor(row)) }).where(eq(accountTokens.id, row.id));
    await enqueueJob(MAIL_ACCOUNT_LINK, { tokenId: row.id, nonce }, {}, tx);
  });
}

/** The token row a mail job is for, only while it is still usable and the job is not stale. */
export async function usableTokenForMail(id: number, nonce: string): Promise<TokenRow & { to: string } | null> {
  const [r] = await getDb()
    .select({ row: accountTokens, email: users.email })
    .from(accountTokens)
    .innerJoin(users, eq(users.id, accountTokens.userId))
    .where(and(eq(accountTokens.id, id), isNull(accountTokens.usedAt), gt(accountTokens.expiresAt, sql`now()`)));
  if (!r || r.row.nonce !== nonce) return null;
  return { ...r.row, to: r.row.newEmail ?? r.email };
}

/** Marks a usable token of this purpose as used and returns it; null for anything else. */
async function claim(tx: Pick<ReturnType<typeof getDb>, "update">, token: string, purpose: Purpose) {
  const [row] = await tx
    .update(accountTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(accountTokens.tokenHash, sha256(token)),
        eq(accountTokens.purpose, purpose),
        isNull(accountTokens.usedAt),
        gt(accountTokens.expiresAt, sql`now()`),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Emails a reset link if the address belongs to an active user. Says nothing either way, so the
 * caller answers the same for every address.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const [user] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deactivatedAt)))
    .limit(1);
  if (!user) return;
  await issueToken(user.id, "password_reset", RESET_TTL_MS, null);
  await recordAudit({ actorId: null, action: "password_reset_requested", targetUserId: user.id });
}

/** Sets the new password (once per link) and signs the user out everywhere. False if the link is not usable. */
export async function completePasswordReset(token: string, password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  const userId = await getDb().transaction(async (tx) => {
    const row = await claim(tx, token, "password_reset");
    if (!row) return null;
    await tx
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(account.userId, row.userId), eq(account.providerId, "credential")));
    // Any other reset link still in a mailbox dies with this one.
    await tx
      .update(accountTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(accountTokens.userId, row.userId), eq(accountTokens.purpose, "password_reset"), isNull(accountTokens.usedAt)));
    return row.userId;
  });
  if (userId === null) return false;
  await revokeAllSessions(userId, { actorId: userId, reason: "password_reset" });
  await recordAudit({ actorId: userId, action: "password_reset_completed", targetUserId: userId });
  return true;
}

const emailTaken = async (email: string) =>
  (await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)).length > 0;

export type EmailChangeResult = { ok: true } | { ok: false; reason: "bad-password" | "taken" };

/**
 * Emails a confirmation link to the new address. Nothing changes until it is confirmed, so a typo
 * cannot lock anyone out. Needs the current password, so a borrowed session cannot take the account.
 */
export async function requestEmailChange(user: { id: number }, newEmail: string, password: string): Promise<EmailChangeResult> {
  const [cred] = await getDb()
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, user.id), eq(account.providerId, "credential")))
    .limit(1);
  if (!cred?.password || !(await bcrypt.compare(password, cred.password))) return { ok: false, reason: "bad-password" };
  if (await emailTaken(newEmail)) return { ok: false, reason: "taken" };
  await issueToken(user.id, "email_change", EMAIL_CHANGE_TTL_MS, newEmail);
  await recordAudit({ actorId: user.id, action: "email_change_requested", targetUserId: user.id, metadata: { to: newEmail } });
  return { ok: true };
}

class TakenError extends Error {}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

/** Applies a confirmed email change (once per link) and signs the user out everywhere. False if not usable. */
export async function confirmEmailChange(token: string): Promise<boolean> {
  const changed = await getDb()
    .transaction(async (tx) => {
      const row = await claim(tx, token, "email_change");
      if (!row?.newEmail) return null;
      const [before] = await tx.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, row.newEmail)).limit(1);
      if (taken) throw new TakenError(); // rolls the claim back too
      await tx.update(users).set({ email: row.newEmail, emailVerified: true, updatedAt: new Date() }).where(eq(users.id, row.userId));
      return { userId: row.userId, from: before.email, to: row.newEmail };
    })
    .catch((err) => {
      if (err instanceof TakenError || isUniqueViolation(err)) return null;
      throw err;
    });
  if (!changed) return false;
  await revokeAllSessions(changed.userId, { actorId: changed.userId, reason: "email_change" });
  await recordAudit({
    actorId: changed.userId,
    action: "email_changed",
    targetUserId: changed.userId,
    metadata: { from: changed.from, to: changed.to },
  });
  return true;
}
