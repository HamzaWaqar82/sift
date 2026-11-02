// The worker's IMAP reader: turns new INBOX mail into tickets and replies through
// ingestInboundEmail. Staging and production log in to the same Gmail account, so the reader
// never changes the mailbox (read-only, no \Seen, no moves or deletes) and each environment keeps
// its own position (UIDVALIDITY + last UID) in its own database. Staging takes only mail to the
// `+staging` alias; production takes everything else. The imapflow adapter is in ./imap-client.
import { setTimeout as sleep } from "node:timers/promises";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { imapFailures, imapState } from "@/lib/db/schema";
import { appEnv, mailFrom, mailTransport } from "@/lib/mail/config";
import type { WorkerService } from "@/lib/worker/services";
import { ingestInboundEmail, UnprocessableEmailError } from "./index";

/** One open, read-only view of a mailbox. The worker uses imapflow; tests use an in-memory fake. */
export type ImapSession = {
  uidValidity: string;
  uidNext: number;
  /** UIDs greater than `uid`, ascending. */
  uidsAfter(uid: number): Promise<number[]>;
  /** The raw message, or null if it vanished since it was listed. Must not set \Seen. */
  fetchSource(uid: number): Promise<Buffer | string | null>;
  /** Resolves on new mail, after `ms`, or when `signal` aborts. Rejects if the connection drops. */
  waitForChange(ms: number, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
};

export const MAILBOX = "INBOX";
export const IMAP_POLL_MS = 60_000;
/** A failing mail is given up only after this many attempts AND this long, so an outage loses nothing. */
export const IMAP_MAX_ATTEMPTS = 5;
export const IMAP_GIVE_UP_AFTER_MINUTES = 15;
/** The reader refreshes its status at least every poll; older than this, health says it's down. */
const STATUS_STALE_SECONDS = 180;
const DEFAULT_BACKOFF_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

type Ingest = (raw: string | Buffer) => Promise<unknown>;

/**
 * Ingests every not-yet-processed mail in the session's mailbox, in UID order, advancing the
 * stored UID after each one. A mail that fails stops the pass so later mail (perhaps a reply to
 * it) waits; it is retried next pass until it is given up. Errors storing our own state throw.
 */
export async function syncInbox(session: ImapSession, opts: { ingest?: Ingest } = {}) {
  const ingest = opts.ingest ?? ingestInboundEmail;
  const db = getDb();
  const [state] = await db.select().from(imapState).where(eq(imapState.mailbox, MAILBOX));
  const uidValidity = session.uidValidity;

  let lastUid: number;
  if (!state) {
    // First ever start: mail already in the INBOX predates this environment, so begin at the end.
    lastUid = Math.max(session.uidNext - 1, 0);
    await db.insert(imapState).values({ mailbox: MAILBOX, uidValidity, lastUid });
    console.log(`[imap] first start: reading ${MAILBOX} mail after UID ${lastUid}`);
    return;
  }
  if (state.uidValidity !== uidValidity) {
    // The server renumbered the mailbox; old UIDs mean nothing. Re-read it all: the Message-ID
    // dedupe in ingest turns mail we already have into duplicates.
    console.warn(`[imap] UIDVALIDITY changed ${state.uidValidity} -> ${uidValidity}; re-reading ${MAILBOX}`);
    lastUid = 0;
    await saveUid(uidValidity, 0);
  } else {
    lastUid = state.lastUid;
  }

  const route = mailRouting();
  for (const uid of await session.uidsAfter(lastUid)) {
    if (uid <= lastUid) continue;
    const raw = await session.fetchSource(uid);
    if (raw !== null && route(raw)) {
      try {
        await ingest(raw);
        await db.delete(imapFailures).where(and(eq(imapFailures.uidValidity, uidValidity), eq(imapFailures.uid, uid)));
      } catch (error) {
        if (!(await recordFailure(uidValidity, uid, error))) return;
      }
    }
    await saveUid(uidValidity, uid);
  }
}

async function saveUid(uidValidity: string, lastUid: number) {
  await getDb().update(imapState).set({ uidValidity, lastUid }).where(eq(imapState.mailbox, MAILBOX));
}

/** Counts a failed attempt. True when the mail is given up (and the reader should move past it). */
async function recordFailure(uidValidity: string, uid: number, error: unknown): Promise<boolean> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000) || "unknown error";
  const hopeless = error instanceof UnprocessableEmailError;
  const [row] = await getDb()
    .insert(imapFailures)
    .values({ uidValidity, uid, lastError: message })
    .onConflictDoUpdate({
      target: [imapFailures.uidValidity, imapFailures.uid],
      set: { attempts: sql`${imapFailures.attempts} + 1`, lastFailedAt: sql`now()`, lastError: message },
    })
    .returning({
      attempts: imapFailures.attempts,
      longEnough: sql<boolean>`${imapFailures.firstFailedAt} <= now() - make_interval(mins => ${IMAP_GIVE_UP_AFTER_MINUTES})`,
    });
  const giveUp = hopeless || (row.attempts >= IMAP_MAX_ATTEMPTS && row.longEnough);
  if (!giveUp) {
    console.error(`[imap] ${MAILBOX} UID ${uid} failed (attempt ${row.attempts}); will retry:`, message);
    return false;
  }
  await getDb()
    .update(imapFailures)
    .set({ gaveUpAt: sql`now()` })
    .where(and(eq(imapFailures.uidValidity, uidValidity), eq(imapFailures.uid, uid), isNull(imapFailures.gaveUpAt)));
  console.error(
    `[imap] GAVE UP on ${MAILBOX} UID ${uid} (UIDVALIDITY ${uidValidity}) after ${row.attempts} attempt(s); ` +
      `it stays in Gmail but is not a ticket (see imap_failures):`,
    message,
  );
  return true;
}

// --- Which environment a mail belongs to ---

/**
 * Gmail ignores dots in the local part and treats googlemail.com as gmail.com; `+tag` is an alias
 * of the same mailbox. Returns the mailbox and the tag ("" when none).
 */
function gmailIdentity(address: string): { box: string; tag: string } {
  const [rawLocal = "", rawDomain = ""] = address.trim().toLowerCase().split("@");
  const gmail = rawDomain === "gmail.com" || rawDomain === "googlemail.com";
  const [local, ...tag] = rawLocal.split("+");
  return { box: `${gmail ? local.replaceAll(".", "") : local}@${gmail ? "gmail.com" : rawDomain}`, tag: tag.join("+") };
}

/** Address-like tokens in the named headers of a raw message (header block only, unfolded). */
function headerAddresses(raw: string, names: string[]): string[] {
  const end = raw.search(/\r?\n\r?\n/);
  const head = (end < 0 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const wanted = new Set(names);
  const found: string[] = [];
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0 || !wanted.has(line.slice(0, colon).trim().toLowerCase())) continue;
    found.push(...(line.slice(colon + 1).match(/[^\s<>,;:"()[\]]+@[^\s<>,;:"()[\]]+/g) ?? []));
  }
  return found;
}

const BOUNCE_SENDERS = new Set(["mailer-daemon", "postmaster"]);

/** Decides, from the headers alone, whether this environment ingests a mail. */
function mailRouting(): (raw: string | Buffer) => boolean {
  const self = gmailIdentity(mailFrom().address).box;
  const staging = appEnv() === "staging";
  return (source) => {
    const raw = typeof source === "string" ? source : source.toString("latin1");
    const from = headerAddresses(raw, ["from"]).map(gmailIdentity);
    // Our own mail (sent copies, notes to self) is never a customer message.
    if (from.some((f) => f.box === self)) return false;
    // Bounces are addressed to the account, not the alias: both environments read them, and the
    // one that sent the bounced reply matches it (the other only records the notice).
    if (from.some((f) => BOUNCE_SENDERS.has(f.box.split("@")[0]))) return true;
    const toAlias = headerAddresses(raw, ["to", "cc", "delivered-to", "x-original-to"])
      .map(gmailIdentity)
      .some((r) => r.box === self && r.tag === "staging");
    return staging === toAlias;
  };
}

// --- Worker service and health ---

/** Records whether the reader is connected, for /api/health in the app process. */
async function setStatus(connected: boolean, lastError: string | null) {
  await getDb()
    .update(imapState)
    .set({ connected, lastError, statusAt: sql`now()` })
    .where(eq(imapState.mailbox, MAILBOX));
}

/**
 * The long-lived reader: connect, catch up, then IDLE (via waitForChange) with a poll every
 * `pollMs` as a fallback, catching up again after each wake. Any failure closes the connection
 * and reconnects with backoff; it never throws, so the other worker services are unaffected.
 * Inactive (no connection at all) unless MAIL_TRANSPORT=gmail.
 */
export function imapReader(
  connect: () => Promise<ImapSession>,
  opts: { pollMs?: number; backoffMs?: number[] } = {},
): WorkerService {
  const pollMs = opts.pollMs ?? IMAP_POLL_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  return {
    name: "imap",
    async run(signal) {
      if (transport() !== "gmail") {
        await pause(2 ** 31 - 1, signal);
        return;
      }
      let failures = 0;
      while (!signal.aborted) {
        let session: ImapSession | undefined;
        try {
          session = await connect();
          console.log(`[imap] connected to ${MAILBOX} (UIDVALIDITY ${session.uidValidity})`);
          while (!signal.aborted) {
            await syncInbox(session);
            await setStatus(true, null);
            failures = 0;
            await session.waitForChange(pollMs, signal);
          }
        } catch (error) {
          if (signal.aborted) break;
          const message = error instanceof Error ? error.message : String(error);
          const delay = backoff[Math.min(failures, backoff.length - 1)];
          failures++;
          console.error(`[imap] connection lost (${message}); reconnecting in ${delay}ms`);
          await setStatus(false, message).catch(() => {});
          await pause(delay, signal);
        } finally {
          await session?.close().catch(() => {});
        }
      }
      await setStatus(false, "stopped").catch(() => {});
    },
  };
}

function transport() {
  try {
    return mailTransport();
  } catch {
    return null;
  }
}

/** For /api/health: `off` unless mail goes through Gmail; else whether the reader is connected. */
export async function imapHealth(): Promise<"up" | "down" | "off"> {
  if (transport() !== "gmail") return "off";
  try {
    const [row] = await getDb()
      .select({
        up: sql<boolean>`${imapState.connected} and ${imapState.statusAt} > now() - make_interval(secs => ${STATUS_STALE_SECONDS})`,
      })
      .from(imapState)
      .where(eq(imapState.mailbox, MAILBOX));
    return row?.up ? "up" : "down";
  } catch {
    return "down";
  }
}

async function pause(ms: number, signal: AbortSignal) {
  await sleep(ms, undefined, { signal }).catch(() => {});
}
