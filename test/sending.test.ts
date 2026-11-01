import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runDueJobs } from "@/lib/jobs";
import { FakeMailer, setMailer } from "@/lib/mail";
import { seedTestUsers, signInAs } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let alice: string;
let mailer: FakeMailer;

beforeAll(async () => {
  await seedTestUsers();
  alice = await signInAs("alice@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets, jobs, suppressed_emails restart identity cascade`;
  mailer = new FakeMailer();
  setMailer(mailer);
});
afterEach(() => setMailer(null));
afterAll(() => sql.end());

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
let keys = 0;
const newKey = () => `send-key-${Date.now()}-${++keys}`;

/** A customer email through the webhook, so the inbound message carries a Message-ID. */
async function inbound(messageId: string, opts: { subject?: string; email?: string } = {}) {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({
    customerEmail: opts.email ?? "cust@example.com",
    customerName: "Casey Customer",
    subject: opts.subject ?? "Export failing",
    body: "My CSV export fails.",
    source: "webhook",
    externalMessageId: messageId,
  });
  return ticket.id;
}

async function latestMessageId(ticketId: number): Promise<number> {
  const [row] = await sql`select id from messages where ticket_id = ${ticketId} order by occurred_at desc, id desc limit 1`;
  return row.id;
}

async function send(ticketId: number, body: Record<string, unknown> = {}, cookie = alice) {
  const { POST } = await import("@/app/api/tickets/[id]/replies/route");
  return POST(
    new Request(`http://localhost/api/tickets/${ticketId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ body: "We fixed the export.", idempotencyKey: newKey(), ...body }),
    }),
    ctx(ticketId),
  );
}

async function outbound(ticketId: number) {
  return sql`select * from messages where ticket_id = ${ticketId} and direction = 'outbound' order by id`;
}

async function ticketRow(ticketId: number) {
  const [row] = await sql`select status, last_outbound_at from tickets where id = ${ticketId}`;
  return row;
}

/** Makes every queued job due now, as if its backoff had elapsed. */
async function elapse() {
  await sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`;
}

describe("queued sending", () => {
  it("queues the reply: no mail yet, ticket not replied, overdue clock untouched", async () => {
    const id = await inbound("<in-1@example.com>");
    const res = await send(id);
    expect(res.status).toBe(201);
    const { message } = await res.json();
    expect(message).toMatchObject({ status: "queued" });

    const [out] = await outbound(id);
    expect(out.status).toBe("queued");
    expect(mailer.sent).toHaveLength(0);
    expect(await ticketRow(id)).toMatchObject({ status: "open", last_outbound_at: null });
    const jobs = await sql`select kind, payload from jobs`;
    expect(jobs).toEqual([{ kind: "mail.send", payload: { messageId: out.id } }]);
  });

  it("the job sends it with Sift's From, its own Message-ID and threading headers, then marks it sent", async () => {
    const id = await inbound("<in-1@example.com>", { subject: "Export failing" });
    await send(id, { body: "Try again now." });
    expect(await runDueJobs()).toMatchObject({ succeeded: 1 });

    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0];
    const [out] = await outbound(id);
    expect(mail).toMatchObject({
      from: { name: "Sift Support" },
      to: ["cust@example.com"],
      subject: "Re: Export failing",
      text: "Try again now.",
      inReplyTo: "<in-1@example.com>",
      references: ["<in-1@example.com>"],
    });
    expect(mail.messageId).toMatch(/^<[^@>]+@[^>]+>$/);
    expect(out).toMatchObject({ status: "sent", message_id: mail.messageId, provider_message_id: mail.messageId, attempts: 1 });
    const t = await ticketRow(id);
    expect(t.status).toBe("replied");
    expect(t.last_outbound_at).not.toBeNull();
  });

  it("threads to the latest inbound message and does not stack Re: prefixes", async () => {
    const id = await inbound("in-1@example.com", { subject: "Re: Export failing" });
    await sql`insert into messages (ticket_id, direction, from_address, subject, body_text, message_id, "references", occurred_at)
              values (${id}, 'inbound', 'cust@example.com', 'Re: Export failing', 'Still broken.', '<in-2@example.com>',
                      '<in-1@example.com>', now() + interval '1 second')`;
    await send(id, { latestMessageId: await latestMessageId(id) });
    await runDueJobs();
    expect(mailer.sent[0]).toMatchObject({
      subject: "Re: Export failing",
      inReplyTo: "<in-2@example.com>",
      references: ["<in-1@example.com>", "<in-2@example.com>"],
    });
  });

  it("never mails internal notes", async () => {
    const id = await inbound("<in-1@example.com>");
    const { addNote } = await import("@/lib/notes");
    const [aliceRow] = await sql`select id from users where email = 'alice@sift.local'`;
    await addNote(id, aliceRow.id, "Customer is on the legacy plan, staff only.");
    await send(id, { body: "We fixed the export." });
    await runDueJobs();
    expect(mailer.sent).toHaveLength(1);
    expect(JSON.stringify(mailer.sent)).not.toContain("legacy plan");
  });
});

describe("failures and retries", () => {
  it("retries with backoff, shows queued with the error meanwhile, and sends on a later try", async () => {
    const id = await inbound("<in-1@example.com>");
    await send(id);
    mailer.failWith(new Error("SMTP 421 try later"));

    expect(await runDueJobs()).toMatchObject({ retried: 1 });
    const [out] = await outbound(id);
    expect(out).toMatchObject({ status: "queued", attempts: 1, last_error: "SMTP 421 try later" });
    const [job] = await sql`select extract(epoch from run_at - now()) as wait from jobs`;
    expect(Number(job.wait)).toBeGreaterThan(5);
    expect(Number(job.wait)).toBeLessThanOrEqual(10);
    expect(await ticketRow(id)).toMatchObject({ status: "open", last_outbound_at: null });

    mailer.failWith(null);
    await elapse();
    await runDueJobs();
    const [after] = await outbound(id);
    expect(after).toMatchObject({ status: "sent", attempts: 2, last_error: null });
    expect(mailer.sent).toHaveLength(1);
  });

  it("marks the message failed after 5 attempts and leaves the ticket unreplied", async () => {
    const id = await inbound("<in-1@example.com>");
    await send(id);
    mailer.failWith(new Error("auth failed"));
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      await runDueJobs();
      const [job] = await sql`select status, extract(epoch from run_at - now()) as wait from jobs`;
      if (job.status === "queued") waits.push(Math.round(Number(job.wait)));
      await elapse();
    }
    expect(waits.map((w) => Math.ceil(w / 10) * 10)).toEqual([10, 60, 300, 1800]);
    const [out] = await outbound(id);
    expect(out).toMatchObject({ status: "failed", attempts: 5, last_error: "auth failed" });
    expect(await ticketRow(id)).toMatchObject({ status: "open", last_outbound_at: null });
    expect(mailer.sent).toHaveLength(0);
  });
});

describe("suppression", () => {
  it("refuses to send to a suppressed address with a clear message, queueing nothing", async () => {
    const id = await inbound("<in-1@example.com>", { email: "Gone@Example.com" });
    await sql`insert into suppressed_emails (email, reason) values ('gone@example.com', 'bounced')`;
    const res = await send(id);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("recipient_suppressed");
    expect(body.error).toMatch(/gone@example\.com/i);
    expect(await outbound(id)).toHaveLength(0);
    expect(await sql`select * from jobs`).toHaveLength(0);
  });
});

describe("stale composer and double sends", () => {
  it("refuses with 409 stale_ticket when a message arrived after the composer loaded", async () => {
    const id = await inbound("<in-1@example.com>");
    const seen = await latestMessageId(id);
    await sql`insert into messages (ticket_id, direction, subject, body_text, occurred_at)
              values (${id}, 'inbound', 'Re: Export failing', 'Any news?', now() + interval '1 second')`;
    const res = await send(id, { latestMessageId: seen });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("stale_ticket");
    expect(await outbound(id)).toHaveLength(0);

    expect((await send(id, { latestMessageId: await latestMessageId(id) })).status).toBe(201);
  });

  it("a double send with one key makes one message and one email, even though the first changed the latest message", async () => {
    const id = await inbound("<in-1@example.com>");
    const seen = await latestMessageId(id);
    const idempotencyKey = newKey();
    const [a, b] = await Promise.all([send(id, { idempotencyKey, latestMessageId: seen }), send(id, { idempotencyKey, latestMessageId: seen })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const again = await send(id, { idempotencyKey, latestMessageId: seen });
    expect(again.status).toBe(200);
    expect(await outbound(id)).toHaveLength(1);
    await runDueJobs();
    expect(mailer.sent).toHaveLength(1);
  });
});
