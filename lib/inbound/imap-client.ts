// imapflow adapter for the IMAP reader (./imap.ts): Gmail's INBOX opened read-only (EXAMINE), so
// nothing we do can change flags or move mail that the other environment still has to read.
// Not covered by automated tests (no test touches the network); verified manually on staging.
import { ImapFlow } from "imapflow";
import { gmailCredentials } from "@/lib/mail/config";
import { MAILBOX, type ImapSession } from "./imap";

export const GMAIL_IMAP_HOST = "imap.gmail.com";
export const GMAIL_IMAP_PORT = 993;

export async function connectGmailInbox(): Promise<ImapSession> {
  const auth = gmailCredentials();
  if (!auth) throw new Error("IMAP needs GMAIL_USER and GMAIL_APP_PASSWORD");
  const client = new ImapFlow({
    host: GMAIL_IMAP_HOST,
    port: GMAIL_IMAP_PORT,
    secure: true,
    auth,
    logger: false,
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    // The reader issues a command at least every poll (60s), so a silent socket this long is dead.
    socketTimeout: 180_000,
  });

  let closed = false;
  let changed = false;
  const waiters = new Set<{ resolve: () => void; reject: (e: Error) => void }>();
  // Without an error listener an EventEmitter error would crash the whole worker.
  client.on("error", (error: Error) => console.error("[imap] client error:", error.message));
  client.on("close", () => {
    closed = true;
    for (const w of waiters) w.reject(new Error("IMAP connection closed"));
  });
  client.on("exists", () => {
    changed = true;
    for (const w of waiters) w.resolve();
  });

  let box;
  try {
    await client.connect();
    box = await client.mailboxOpen(MAILBOX, { readOnly: true });
  } catch (error) {
    client.close();
    throw error;
  }

  return {
    uidValidity: String(box.uidValidity),
    uidNext: box.uidNext,
    async uidsAfter(uid) {
      // `n:*` always matches the newest message even when its UID is below n, hence the filter.
      const found = await client.search({ uid: `${uid + 1}:*` }, { uid: true });
      return (found || []).filter((u) => u > uid).sort((a, b) => a - b);
    },
    async fetchSource(uid) {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
      return message && message.source ? message.source : null;
    },
    waitForChange(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (closed) return reject(new Error("IMAP connection closed"));
        // Mail that arrived during the last pass wakes us at once.
        if (changed || signal.aborted) {
          changed = false;
          return resolve();
        }
        const done = (fn: () => void) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          waiters.delete(waiter);
          changed = false;
          fn();
        };
        const waiter = { resolve: () => done(resolve), reject: (e: Error) => done(() => reject(e)) };
        const onAbort = () => waiter.resolve();
        const timer = setTimeout(waiter.resolve, ms);
        signal.addEventListener("abort", onAbort);
        waiters.add(waiter);
      });
    },
    async close() {
      if (closed) return;
      await client.logout().catch(() => client.close());
    },
  };
}
