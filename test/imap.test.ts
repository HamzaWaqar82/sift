import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestInboundEmail } from "@/lib/inbound";
import { imapHealth, imapReader, syncInbox, type ImapSession } from "@/lib/inbound/imap";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const SUPPORT = "support.desk@gmail.com";
const STAGING_ALIAS = "support.desk+staging@gmail.com";

/** An in-memory INBOX standing in for Gmail: the reader only ever sees it through ImapSession. */
class FakeInbox {
  uidValidity = "100";
  mails = new Map<number, string>();
  nextUid = 1;
  connections = 0;
  refuseConnections = false;
  private waiters = new Set<{ resolve: () => void; reject: (e: Error) => void }>();

  deliver(raw: string) {
    const uid = this.nextUid++;
    this.mails.set(uid, raw);
    for (const w of this.waiters) w.resolve();
    return uid;
  }

  /** Simulates the server dropping the connection while the reader idles. */
  drop() {
    this.epoch++;
    for (const w of this.waiters) w.reject(new Error("connection closed"));
  }
  private epoch = 0;

  connect = async (): Promise<ImapSession> => {
    this.connections++;
    if (this.refuseConnections) throw new Error("ECONNREFUSED");
    const inbox = this;
    const epoch = this.epoch;
    return {
      uidValidity: this.uidValidity,
      uidNext: this.nextUid,
      async uidsAfter(uid) {
        return [...inbox.mails.keys()].filter((u) => u > uid).sort((a, b) => a - b);
      },
      async fetchSource(uid) {
        return inbox.mails.get(uid) ?? null;
      },
      waitForChange(ms, signal) {
        return new Promise<void>((resolve, reject) => {
          if (epoch !== inbox.epoch) return reject(new Error("connection closed"));
          const waiter = {
            resolve: () => done(resolve),
            reject: (e: Error) => done(() => reject(e)),
          };
          const timer = setTimeout(waiter.resolve, ms);
          const onAbort = () => waiter.resolve();
          const done = (fn: () => void) => {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            inbox.waiters.delete(waiter);
            fn();
          };
          signal.addEventListener("abort", onAbort);
          inbox.waiters.add(waiter);
        });
      },
      async close() {},
    };
  };
}

let seq = 0;
function mail(opts: { from?: string; to?: string; extra?: string; subject?: string } = {}) {
  const id = `<m${++seq}-${Date.now()}@example.com>`;
  const raw = [
    `From: Dana Customer <${opts.from ?? "dana@example.com"}>`,
    `To: ${opts.to ?? SUPPORT}`,
    `Subject: ${opts.subject ?? `Question ${seq}`}`,
    `Message-ID: ${id}`,
    "Date: Mon, 02 Nov 2026 10:00:00 +0000",
    ...(opts.extra ? [opts.extra] : []),
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hello, I need help.",
    "",
  ].join("\r\n");
  return { id, raw };
}

async function ticketCount() {
  const [row] = await sql`select count(*)::int as n from tickets`;
  return row.n as number;
}
async function messageIds() {
  return (await sql`select message_id from messages order by id`).map((r) => r.message_id as string);
}
async function lastUid() {
  const [row] = await sql`select last_uid from imap_state where mailbox = 'INBOX'`;
  return row ? Number(row.last_uid) : null;
}

/** Puts the reader at the start of the fake INBOX, as if it had already read everything before. */
async function startAtBeginning(inbox: FakeInbox) {
  await sql`insert into imap_state (mailbox, uid_validity, last_uid) values ('INBOX', ${inbox.uidValidity}, 0)`;
}

const env = { ...process.env };
let inbox: FakeInbox;
beforeEach(async () => {
  await sql`truncate tickets, jobs, inbound_bounces, imap_state, imap_failures restart identity cascade`;
  process.env.GMAIL_USER = SUPPORT;
  process.env.APP_ENV = "production";
  inbox = new FakeInbox();
});
afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
});
afterAll(() => sql.end());

describe("syncInbox", () => {
  it("ingests new mail in UID order and never reprocesses it, even across reconnects", async () => {
    await startAtBeginning(inbox);
    const a = mail();
    const b = mail();
    inbox.deliver(a.raw);
    inbox.deliver(b.raw);

    await syncInbox(await inbox.connect());
    expect(await messageIds()).toEqual([a.id, b.id]);
    expect(await lastUid()).toBe(2);

    const ingest = vi.fn(ingestInboundEmail);
    await syncInbox(await inbox.connect(), { ingest });
    expect(ingest).not.toHaveBeenCalled();

    const c = mail();
    inbox.deliver(c.raw);
    await syncInbox(await inbox.connect(), { ingest });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(await messageIds()).toEqual([a.id, b.id, c.id]);
  });

  it("on its very first run starts at the end of the mailbox instead of importing its history", async () => {
    inbox.deliver(mail().raw);
    inbox.deliver(mail().raw);

    await syncInbox(await inbox.connect());
    expect(await ticketCount()).toBe(0);
    expect(await lastUid()).toBe(2);

    const fresh = mail();
    inbox.deliver(fresh.raw);
    await syncInbox(await inbox.connect());
    expect(await messageIds()).toEqual([fresh.id]);
  });

  it("production skips mail to the +staging alias and our own sent copies; staging takes only the alias", async () => {
    await startAtBeginning(inbox);
    const customer = mail();
    const toStaging = mail({ to: `"Support" <${STAGING_ALIAS}>` });
    const bccStaging = mail({ extra: `Delivered-To: ${STAGING_ALIAS}` });
    const ours = mail({ from: SUPPORT, to: "dana@example.com" });
    const oursToAlias = mail({ from: "Support.Desk@gmail.com", to: STAGING_ALIAS });
    for (const m of [customer, toStaging, bccStaging, ours, oursToAlias]) inbox.deliver(m.raw);

    await syncInbox(await inbox.connect());
    expect(await messageIds()).toEqual([customer.id]);
    expect(await lastUid()).toBe(5);

    await sql`truncate tickets, imap_state restart identity cascade`;
    await startAtBeginning(inbox);
    process.env.APP_ENV = "staging";
    await syncInbox(await inbox.connect());
    expect(await messageIds()).toEqual([toStaging.id, bccStaging.id]);
  });

  it("both environments read bounce notices, since a bounce never names the alias", async () => {
    await startAtBeginning(inbox);
    inbox.deliver(readFileSync("test/fixtures/inbound/bounce.eml", "utf8"));
    process.env.APP_ENV = "staging";

    await syncInbox(await inbox.connect());

    const [row] = await sql`select count(*)::int as n from inbound_bounces`;
    expect(row.n).toBe(1);
  });

  it("leaves a failed mail for the next pass and does not skip past it", async () => {
    await startAtBeginning(inbox);
    const a = mail();
    const b = mail();
    inbox.deliver(a.raw);
    inbox.deliver(b.raw);
    const ingest = vi.fn(ingestInboundEmail).mockRejectedValueOnce(new Error("db hiccup"));

    await syncInbox(await inbox.connect(), { ingest });
    expect(await messageIds()).toEqual([]);
    expect(await lastUid()).toBe(0);

    await syncInbox(await inbox.connect(), { ingest });
    expect(await messageIds()).toEqual([a.id, b.id]);
    expect(await lastUid()).toBe(2);
    expect(await sql`select * from imap_failures`).toHaveLength(0);
  });

  it("gives up on a mail that keeps failing for long enough, records it and moves on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await startAtBeginning(inbox);
    const poison = mail();
    const next = mail();
    inbox.deliver(poison.raw);
    inbox.deliver(next.raw);
    const ingest = vi.fn(async (raw: string | Buffer) => {
      if (String(raw).includes(poison.id)) throw new Error("cannot store this");
      return ingestInboundEmail(raw);
    });

    // Many quick failures alone are not enough: a short outage must never lose mail.
    for (let i = 0; i < 6; i++) await syncInbox(await inbox.connect(), { ingest });
    expect(await lastUid()).toBe(0);

    await sql`update imap_failures set first_failed_at = now() - interval '1 hour'`;
    await syncInbox(await inbox.connect(), { ingest });

    expect(await messageIds()).toEqual([next.id]);
    expect(await lastUid()).toBe(2);
    const [failure] = await sql`select uid, attempts, last_error, gave_up_at from imap_failures`;
    expect(failure).toMatchObject({ uid: "1", last_error: "cannot store this" });
    expect(failure.gave_up_at).not.toBeNull();
  });

  it("gives up at once on a mail that can never be ingested (no sender)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await startAtBeginning(inbox);
    inbox.deliver("Subject: no sender\r\nMessage-ID: <nosender@example.com>\r\n\r\nhi\r\n");
    const good = mail();
    inbox.deliver(good.raw);

    await syncInbox(await inbox.connect());

    expect(await messageIds()).toEqual([good.id]);
    expect(await sql`select uid from imap_failures where gave_up_at is not null`).toHaveLength(1);
  });

  it("re-reads the mailbox after a UIDVALIDITY change without duplicating anything", async () => {
    await startAtBeginning(inbox);
    const a = mail();
    inbox.deliver(a.raw);
    await syncInbox(await inbox.connect());

    // The server renumbered the mailbox: the same mail now has new UIDs, plus one new mail.
    const b = mail();
    inbox.uidValidity = "200";
    inbox.mails = new Map([[1, b.raw], [2, a.raw]]);
    inbox.nextUid = 3;
    await syncInbox(await inbox.connect());

    expect(await messageIds()).toEqual([a.id, b.id]);
    const [state] = await sql`select uid_validity, last_uid from imap_state`;
    expect(state).toMatchObject({ uid_validity: "200", last_uid: "2" });
  });
});

describe("imapReader worker service", () => {
  const fast = { pollMs: 50, backoffMs: [10, 20] };
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("timed out waiting");
  };

  it("does nothing and reports off unless mail goes through Gmail", async () => {
    process.env.MAIL_TRANSPORT = "capture";
    const controller = new AbortController();
    const running = imapReader(inbox.connect, fast).run(controller.signal);
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    await running;

    expect(inbox.connections).toBe(0);
    expect(await imapHealth()).toBe("off");
  });

  it("picks up new mail while idling, reconnects after drops and refusals, and reports its state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.MAIL_TRANSPORT = "gmail";
    await startAtBeginning(inbox);
    expect(await imapHealth()).toBe("down");

    const controller = new AbortController();
    const running = imapReader(inbox.connect, fast).run(controller.signal);
    await until(async () => (await imapHealth()) === "up");

    const first = mail();
    inbox.deliver(first.raw);
    await until(async () => (await ticketCount()) === 1);

    inbox.refuseConnections = true;
    inbox.drop();
    await until(async () => (await imapHealth()) === "down");
    await until(async () => inbox.connections >= 4);

    inbox.refuseConnections = false;
    const second = mail();
    inbox.deliver(second.raw);
    await until(async () => (await ticketCount()) === 2);
    await until(async () => (await imapHealth()) === "up");

    controller.abort();
    await running;
    expect(await imapHealth()).toBe("down");
  });

  it("reports down when the reader stops updating its status", async () => {
    process.env.MAIL_TRANSPORT = "gmail";
    await sql`insert into imap_state (mailbox, uid_validity, connected, status_at)
      values ('INBOX', '1', true, now() - interval '10 minutes')`;
    expect(await imapHealth()).toBe("down");
  });
});
