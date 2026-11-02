import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearDemoTickets } from "../scripts/clear-demo-data.mjs";
import { sampleEmails, seedSampleTickets } from "../scripts/seed.mjs";
import { runDueJobs } from "@/lib/jobs";
import { FakeMailer, setMailer } from "@/lib/mail";
import { giveTicketTo, seedTestUsers, signInAs } from "./helpers";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });

beforeAll(seedTestUsers);
beforeEach(async () => {
  await sql`truncate tickets, jobs restart identity cascade`;
});
afterAll(() => sql.end());

describe("clearing demo tickets", () => {
  it("deletes only the sample tickets and everything hanging off them, and is idempotent", async () => {
    const seeded = await seedSampleTickets(url);
    const { createTicket } = await import("@/lib/tickets");
    const { ticket: real } = await createTicket({
      customerEmail: "real@customer.test",
      customerName: "Real Customer",
      subject: "Real problem",
      body: "Help.",
      source: "webhook",
      externalMessageId: "<real-1@customer.test>",
    });
    const [demo] = await sql`select id from tickets where id <> ${real.id} limit 1`;
    const [author] = await sql`select id from users limit 1`;
    await sql`insert into internal_notes (ticket_id, author_id, body) values (${demo.id}, ${author.id}, 'note')`;
    await sql`insert into triage_results (ticket_id, error, model) values (${demo.id}, 'boom', 'm')`;
    // createTicket already queued the real ticket's automatic triage; give a demo ticket one too.
    await sql`insert into jobs (kind, payload) values ('triage.auto', ${sql.json({ ticketId: demo.id })})`;

    expect(await clearDemoTickets(url)).toBe(seeded);
    expect(await sql`select id from tickets`).toEqual([{ id: real.id }]);
    expect(await sql`select ticket_id from messages`).toEqual([{ ticket_id: real.id }]);
    expect(await sql`select 1 from internal_notes`).toHaveLength(0);
    expect(await sql`select 1 from triage_results`).toHaveLength(0);
    expect(await sql`select payload->>'ticketId' as t from jobs`).toEqual([{ t: String(real.id) }]);

    expect(await clearDemoTickets(url)).toBe(0);
  });
});

describe("mail to a demo address in production", () => {
  let mailer: FakeMailer;
  const appEnv = process.env.APP_ENV;
  beforeEach(() => {
    mailer = new FakeMailer();
    setMailer(mailer);
    process.env.APP_ENV = "production";
  });
  afterEach(() => {
    setMailer(null);
    process.env.APP_ENV = appEnv;
  });

  it("is refused: the reply fails at once with a clear reason and nothing is sent", async () => {
    const [sample] = await sampleEmails();
    const { createTicket } = await import("@/lib/tickets");
    const { ticket } = await createTicket({
      customerEmail: sample.from.email,
      customerName: sample.from.name,
      subject: sample.subject,
      body: sample.body,
      source: "webhook",
      externalMessageId: sample.message_id,
    });
    await giveTicketTo(ticket.id);
    const [latest] = await sql`select id from messages where ticket_id = ${ticket.id}`;
    const { POST } = await import("@/app/api/tickets/[id]/replies/route");
    const res = await POST(
      new Request(`http://localhost/api/tickets/${ticket.id}/replies`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: await signInAs("alice@sift.local") },
        body: JSON.stringify({ body: "Hello", idempotencyKey: "demo-key-1", latestMessageId: latest.id }),
      }),
      { params: Promise.resolve({ id: String(ticket.id) }) },
    );
    expect(res.status).toBeLessThan(300);

    await runDueJobs();
    expect(mailer.sent).toHaveLength(0);
    const [out] = await sql`select status, last_error from messages where ticket_id = ${ticket.id} and direction = 'outbound'`;
    expect(out).toMatchObject({ status: "failed", last_error: expect.stringMatching(/demo/i) });
  });
});
