import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs, giveTicketTo } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let alice: string;

beforeAll(async () => {
  await seedTestUsers();
  alice = await signInAs("alice@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
});
afterEach(() => {
  delete process.env.OVERDUE_HOURS;
});
afterAll(async () => {
  await sql.end();
});

/** A ticket whose customer last wrote `minutesAgo` minutes ago (by the database clock). */
async function ticket(subject: string, minutesAgo: number, status: "open" | "replied" | "closed" = "open") {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({ customerEmail: "c@example.com", subject, body: "help", source: "form" });
  await customerWrote(ticket.id, minutesAgo);
  await giveTicketTo(ticket.id);
  await sql`update tickets set status = ${status} where id = ${ticket.id}`;
  return ticket.id;
}

/** A new customer message on the ticket, `minutesAgo` minutes ago. */
async function customerWrote(id: number, minutesAgo: number) {
  await sql`update tickets set last_inbound_at = now() - ${minutesAgo} * interval '1 minute' where id = ${id}`;
}

async function reply(id: number) {
  const { POST } = await import("@/app/api/tickets/[id]/replies/route");
  const res = await POST(
    new Request(`http://localhost/api/tickets/${id}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice },
      body: JSON.stringify({ body: "On it.", idempotencyKey: `k-${id}-${Date.now()}` }),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  expect(res.status).toBe(201);
}

async function get(path: string, query = "") {
  const mod = await import(`@/app/api/tickets/${path}route`);
  const res = await mod.GET(new Request(`http://localhost/api/tickets/${path}${query}`, { headers: { cookie: alice } }));
  return { status: res.status, body: await res.json() };
}

type Row = { subject: string; overdueWaitingSince: string | null };
const overdueSubjects = async (query = "") =>
  ((await get("", query)).body.tickets as Row[]).filter((t) => t.overdueWaitingSince).map((t) => t.subject).sort();
const overdueCount = async () => (await import("@/lib/tickets/overdue")).overdueCount();

const DAY = 24 * 60;

describe("overdue rule", () => {
  it("marks an unanswered customer message once it is OVERDUE_HOURS old, not a minute before", async () => {
    await ticket("fresh", DAY - 1);
    await ticket("exactly 24h", DAY);
    await ticket("two days", 2 * DAY);
    expect(await overdueSubjects()).toEqual(["exactly 24h", "two days"]);

    const { tickets } = (await get("")).body as { tickets: (Row & { overdueWaitingSince: string })[] };
    const twoDays = tickets.find((t) => t.subject === "two days")!;
    expect(Date.now() - new Date(twoDays.overdueWaitingSince).getTime()).toBeGreaterThanOrEqual(2 * DAY * 60_000 - 5_000);
  });

  it("takes the threshold from OVERDUE_HOURS", async () => {
    await ticket("three hours", 3 * 60);
    await ticket("one hour", 60);
    process.env.OVERDUE_HOURS = "2";
    expect(await overdueSubjects()).toEqual(["three hours"]);
  });

  it("never marks a closed ticket, however old", async () => {
    await ticket("closed", 5 * DAY, "closed");
    await ticket("open", 5 * DAY);
    expect(await overdueSubjects()).toEqual(["open"]);
    expect(await overdueCount()).toBe(1);
  });

  it("is cleared by a sent reply and re-armed by the customer's next message", async () => {
    const id = await ticket("waiting", 2 * DAY);
    await reply(id);
    expect(await overdueSubjects()).toEqual(["waiting"]); // queued, not sent yet
    const { runDueJobs } = await import("@/lib/jobs");
    await runDueJobs();
    expect(await overdueSubjects()).toEqual([]);

    // The customer writes again after the reply: the clock restarts from that message.
    await sql`update tickets set last_outbound_at = now() - interval '30 hours' where id = ${id}`;
    await customerWrote(id, 60);
    expect(await overdueSubjects()).toEqual([]);
    await customerWrote(id, DAY + 60);
    expect(await overdueSubjects()).toEqual(["waiting"]);
  });

  it("a newer customer message on an overdue ticket restarts the clock", async () => {
    const id = await ticket("waiting", 3 * DAY);
    expect(await overdueCount()).toBe(1);
    await customerWrote(id, 5);
    expect(await overdueCount()).toBe(0);
  });

  it("is not cleared by an outbound message that was never sent", async () => {
    const id = await ticket("queued reply", 2 * DAY);
    // A reply that has not reached `sent` (queued, failed, bounced) leaves last_outbound_at alone.
    await sql`insert into messages (ticket_id, direction, subject, body_text, occurred_at, status, attempts)
              values (${id}, 'outbound', 'Re: queued reply', 'On it.', now(), 'failed', 1)`;
    expect(await overdueSubjects()).toEqual(["queued reply"]);
  });
});

describe("overdue filter and count", () => {
  beforeEach(async () => {
    await ticket("overdue open", 2 * DAY);
    await ticket("overdue replied-earlier", 3 * DAY, "replied");
    await ticket("fresh", 60);
    await ticket("closed old", 4 * DAY, "closed");
  });

  it("overdue=1 lists only overdue tickets and combines with other filters", async () => {
    const all = await get("", "?overdue=1");
    expect(all.status).toBe(200);
    expect((all.body.tickets as Row[]).map((t) => t.subject).sort()).toEqual(["overdue open", "overdue replied-earlier"]);

    const open = await get("", "?overdue=1&status=open&q=overdue");
    expect((open.body.tickets as Row[]).map((t) => t.subject)).toEqual(["overdue open"]);
  });

  it("rejects any other overdue value", async () => {
    const res = await get("", "?overdue=yes");
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty("overdue");
  });

  it("applies to the summary and board", async () => {
    expect((await get("summary/", "?overdue=1")).body).toEqual({ total: 2, byStatus: { open: 1, replied: 1, closed: 0 } });
    const board = (await get("board/", "?overdue=1")).body;
    expect(board.columns.open.count).toBe(1);
    expect(board.columns.open.tickets[0].overdueWaitingSince).not.toBeNull();
  });

  it("counts every overdue ticket for the header", async () => {
    expect(await overdueCount()).toBe(2);
  });

  it("can be saved in a view", async () => {
    await sql`delete from saved_views`;
    const { POST } = await import("@/app/api/views/route");
    const res = await POST(
      new Request("http://localhost/api/views", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alice },
        body: JSON.stringify({ name: `Overdue ${Date.now()}`, params: { overdue: "1", status: "open" } }),
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).view.params).toEqual({ overdue: "1", status: "open" });
  });
});
