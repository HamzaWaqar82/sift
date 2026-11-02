// Invitations: an admin invites an email address with a role; the invitee opens the emailed link,
// sets a name and password, and is signed in. Accepting counts as email verification.
//
// Only the SHA-256 of the token is stored. The token is HMAC(SESSION_SECRET, id:nonce), so the mail
// job can rebuild the same link from the row without the plaintext ever being written to the
// database or the job payload. Resending rotates the nonce, which kills the old link.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { appBaseUrl, getAuth, hashPassword } from "@/lib/auth/better-auth";
import { getDb } from "@/lib/db";
import { account, invitations, users, type UserRole } from "@/lib/db/schema";
import { MAIL_INVITE } from "@/lib/jobs/kinds/mail-invite";
import { enqueueJob } from "@/lib/jobs/queue";

export const INVITE_INVALID_MESSAGE = "This invitation link is no longer valid. Ask an admin to send you a new one.";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";
export type InviteRow = typeof invitations.$inferSelect;

export type InviteSummary = {
  id: number;
  email: string;
  role: UserRole;
  status: InviteStatus;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return value;
}

/** The plaintext token for an invitation row (never stored). */
export function inviteToken(row: Pick<InviteRow, "id" | "nonce">): string {
  return createHmac("sha256", secret()).update(`invite:${row.id}:${row.nonce}`).digest("base64url");
}

export const inviteLink = (token: string) => `${appBaseUrl()}/invite/${token}`;

function statusOf(row: InviteRow, now = new Date()): InviteStatus {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  return row.expiresAt <= now ? "expired" : "pending";
}

const newNonce = () => randomBytes(16).toString("base64url");

export type CreateResult = { ok: true; invite: InviteSummary } | { ok: false; reason: "has-account" | "already-pending" };

export async function createInvite(admin: { id: number }, email: string, role: UserRole): Promise<CreateResult> {
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { ok: false, reason: "has-account" };
  const [pending] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, sql`now()`)),
    )
    .limit(1);
  if (pending) return { ok: false, reason: "already-pending" };

  const nonce = newNonce();
  const id = await db.transaction(async (tx) => {
    // The token depends on the row id, so insert with a placeholder hash and fill it in.
    const [row] = await tx
      .insert(invitations)
      .values({ email, role, nonce, tokenHash: `pending:${nonce}`, invitedBy: admin.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
      .returning();
    await tx.update(invitations).set({ tokenHash: sha256(inviteToken(row)) }).where(eq(invitations.id, row.id));
    await enqueueJob(MAIL_INVITE, { invitationId: row.id, nonce }, {}, tx);
    return row.id;
  });
  await recordAudit({ actorId: admin.id, action: "invite_created", metadata: { invitationId: id, email, role } });
  return { ok: true, invite: (await getInvite(id))! };
}

/** New link and a fresh 7 days; the old link stops working. Not for accepted or revoked invites. */
export async function resendInvite(admin: { id: number }, id: number): Promise<InviteSummary | null> {
  const nonce = newNonce();
  const updated = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(invitations)
      .set({ nonce, tokenHash: sha256(inviteToken({ id, nonce })), expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
      .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ email: invitations.email });
    if (row) await enqueueJob(MAIL_INVITE, { invitationId: id, nonce }, {}, tx);
    return row;
  });
  if (!updated) return null;
  await recordAudit({ actorId: admin.id, action: "invite_resent", metadata: { invitationId: id, email: updated.email } });
  return getInvite(id);
}

export async function revokeInvite(admin: { id: number }, id: number): Promise<InviteSummary | null> {
  const [row] = await getDb()
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .returning({ email: invitations.email, role: invitations.role });
  if (!row) return null;
  await recordAudit({ actorId: admin.id, action: "invite_revoked", metadata: { invitationId: id, ...row } });
  return getInvite(id);
}

const summaryColumns = {
  row: invitations,
  invitedBy: sql<string | null>`(select name from users where users.id = ${invitations.invitedBy})`,
};

function summarize(r: { row: InviteRow; invitedBy: string | null }): InviteSummary {
  const { row } = r;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: statusOf(row),
    invitedBy: r.invitedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function getInvite(id: number): Promise<InviteSummary | null> {
  const [r] = await getDb().select(summaryColumns).from(invitations).where(eq(invitations.id, id));
  return r ? summarize(r) : null;
}

export async function listInvites(): Promise<InviteSummary[]> {
  return (await getDb().select(summaryColumns).from(invitations).orderBy(desc(invitations.id))).map(summarize);
}

/** The invitation a mail job is for, only while it can still be accepted and the job is not stale. */
export async function pendingInviteForMail(id: number, nonce: string): Promise<{ row: InviteRow; token: string } | null> {
  const [row] = await getDb().select().from(invitations).where(eq(invitations.id, id));
  if (!row || row.nonce !== nonce || statusOf(row) !== "pending") return null;
  return { row, token: inviteToken(row) };
}

/** A pending invitation for this token, or null for anything else (unknown, expired, used, revoked). */
export async function findPendingInvite(token: string): Promise<{ email: string; role: UserRole } | null> {
  const [row] = await getDb().select().from(invitations).where(eq(invitations.tokenHash, sha256(token)));
  if (!row || statusOf(row) !== "pending") return null;
  const [taken] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, row.email)).limit(1);
  return taken ? null : { email: row.email, role: row.role };
}

export type AcceptResult = { ok: true; userId: number; cookies: string[] } | { ok: false };

class TakenError extends Error {}

/**
 * Consumes the invitation (once), creates the verified user with their password, and signs them
 * in. Every failure is the same `{ ok: false }`, so callers cannot tell why a link did not work.
 */
export async function acceptInvite(token: string, input: { name: string; password: string }, headers: Headers): Promise<AcceptResult> {
  const passwordHash = await hashPassword(input.password);
  const created = await getDb()
    .transaction(async (tx) => {
      // The single-use guard: only one caller gets the row back.
      const [claimed] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.tokenHash, sha256(token)),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, sql`now()`),
          ),
        )
        .returning();
      if (!claimed) return null;
      const [user] = await tx
        .insert(users)
        .values({ email: claimed.email, name: input.name, role: claimed.role, emailVerified: true })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      if (!user) throw new TakenError(); // rolls the claim back too
      await tx.insert(account).values({ accountId: String(user.id), providerId: "credential", userId: user.id, password: passwordHash });
      return { claimed, userId: user.id };
    })
    .catch((err) => {
      if (err instanceof TakenError) return null;
      throw err;
    });
  if (!created) return { ok: false };

  await recordAudit({
    actorId: created.userId,
    action: "invite_accepted",
    targetUserId: created.userId,
    metadata: { invitationId: created.claimed.id, email: created.claimed.email, role: created.claimed.role },
  });

  // Sign in through Better Auth so the session row and cookie are exactly what a normal sign-in makes.
  const forwarded = new Headers(headers);
  forwarded.set("content-type", "application/json");
  forwarded.delete("content-length");
  forwarded.set("origin", appBaseUrl()); // a server-side call; satisfies Better Auth's origin check
  const res = await getAuth().handler(
    new Request(new URL("/api/auth/sign-in/email", appBaseUrl()), {
      method: "POST",
      headers: forwarded,
      body: JSON.stringify({ email: created.claimed.email, password: input.password }),
    }),
  );
  if (res.status !== 200) throw new Error(`Sign-in after accepting an invite returned ${res.status}`);
  return { ok: true, userId: created.userId, cookies: res.headers.getSetCookie() };
}
