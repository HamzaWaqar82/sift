import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let agent: string;

beforeAll(async () => {
  await seedTestUsers();
  agent = await signInAs("alice@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
});
afterAll(async () => {
  await sql.end();
});

async function createViaForm(body: unknown, cookie = agent) {
  const { POST } = await import("@/app/api/tickets/route");
  return POST(
    new Request("http://localhost/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );
}

async function getTicket(id: number, cookie = agent) {
  const { GET } = await import("@/app/api/tickets/[id]/route");
  return GET(new Request(`http://localhost/api/tickets/${id}`, { headers: { cookie } }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

async function listTickets(query: string, cookie = agent) {
  const { GET } = await import("@/app/api/tickets/route");
  return GET(new Request(`http://localhost/api/tickets${query}`, { headers: { cookie } }));
}

/** Inserts `n` webhook tickets, one minute apart starting at `start`, returning their ids oldest first. */
async function insertTickets(n: number, start = new Date("2026-10-01T09:00:00.000Z"), prefix = "T") {
  const { createTicket } = await import("@/lib/tickets");
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const { ticket } = await createTicket({
      customerEmail: `c${i}@example.com`,
      subject: `${prefix}${i}`,
      body: "hello",
      source: "webhook",
      externalMessageId: `<${prefix}-${i}@example.com>`,
      createdAt: new Date(start.getTime() + i * 60_000),
    });
    ids.push(ticket.id);
  }
  return ids;
}

async function readAllPages(query: string) {
  const seen: number[] = [];
  let cursor: string | null = null;
  do {
    const sep = query ? "&" : "?";
    const res = await listTickets(cursor ? `${query}${sep}cursor=${encodeURIComponent(cursor)}` : query);
    const json = await res.json();
    seen.push(...json.tickets.map((t: { id: number }) => t.id));
    cursor = json.nextCursor;
  } while (cursor);
  return seen;
}

describe("ticket list", () => {
  it("shows tickets newest first with the fields an agent scans", async () => {
    const [older, newer] = await insertTickets(2);
    await sql`update tickets set assignee_id = (select id from users where email = 'ben@sift.local') where id = ${older}`;

    const res = await listTickets("");

    expect(res.status).toBe(200);
    const { tickets, nextCursor } = await res.json();
    expect(tickets.map((t: { id: number }) => t.id)).toEqual([newer, older]);
    expect(tickets[1]).toMatchObject({
      subject: "T0",
      customerEmail: "c0@example.com",
      status: "open",
      source: "webhook",
      createdAt: "2026-10-01T09:00:00.000Z",
      assignee: { name: "Ben Agent" },
      triage: null,
    });
    expect(nextCursor).toBeNull();
  });

  it("shows the latest triage summary only for triaged tickets", async () => {
    const [plain, triaged, failed] = await insertTickets(3);
    await sql`insert into triage_results (ticket_id, error, raw_output, model) values (${triaged}, 'bad json', '{', 'm')`;
    await sql`insert into triage_results (ticket_id, category, urgency, draft, model, created_at)
              values (${triaged}, 'billing', 'high', 'Hi', 'm', now() + interval '1 second')`;
    await sql`insert into triage_results (ticket_id, error, raw_output, model) values (${failed}, 'bad json', '{', 'm')`;

    const { tickets } = await (await listTickets("")).json();
    const byId = Object.fromEntries(tickets.map((t: { id: number }) => [t.id, t]));

    expect(byId[plain].triage).toBeNull();
    expect(byId[triaged].triage).toEqual({ ok: true, category: "billing", urgency: "high" });
    expect(byId[failed].triage).toEqual({ ok: false });
  });

  it("filters by status", async () => {
    const [a, b, c] = await insertTickets(3);
    await sql`update tickets set status = 'closed' where id in (${a}, ${c})`;
    await sql`update tickets set status = 'replied' where id = ${b}`;

    const closed = await (await listTickets("?status=closed")).json();
    const replied = await (await listTickets("?status=replied")).json();
    const open = await (await listTickets("?status=open")).json();

    expect(closed.tickets.map((t: { id: number }) => t.id)).toEqual([c, a]);
    expect(replied.tickets.map((t: { id: number }) => t.id)).toEqual([b]);
    expect(open.tickets).toEqual([]);
  });

  it("rejects an unknown status and a forged cursor with 400", async () => {
    expect((await listTickets("?status=deleted")).status).toBe(400);
    expect((await listTickets("?cursor=not-a-cursor")).status).toBe(400);
  });

  it("requires sign-in", async () => {
    expect((await listTickets("", "")).status).toBe(401);
  });
});

describe("cursor paging", () => {
  it("pages 20 at a time and visits every ticket exactly once", async () => {
    const ids = await insertTickets(45);

    const first = await (await listTickets("")).json();
    expect(first.tickets).toHaveLength(20);
    expect(await readAllPages("")).toEqual([...ids].reverse());
  });

  it("orders tickets with the same timestamp by id, without skipping across pages", async () => {
    const ids = await insertTickets(25);
    await sql`update tickets set created_at = '2026-10-01T09:00:00Z'`;

    expect(await readAllPages("")).toEqual([...ids].reverse());
  });

  it("never duplicates or skips when new tickets arrive between pages", async () => {
    const ids = await insertTickets(30);
    const first = await (await listTickets("")).json();

    // New mail arrives (newer than everything) while the agent reads page 1.
    await insertTickets(5, new Date("2026-10-30T09:00:00.000Z"), "NEW");
    const second = await (
      await listTickets(`?cursor=${encodeURIComponent(first.nextCursor)}`)
    ).json();

    const seen = [...first.tickets, ...second.tickets].map((t: { id: number }) => t.id);
    expect(seen).toEqual([...ids].reverse());
    expect(second.nextCursor).toBeNull();
  });

  it("keeps the status filter while paging", async () => {
    const ids = await insertTickets(24);
    const closedIds = ids.filter((_, i) => i % 2 === 0);
    await sql`update tickets set status = 'closed' where id = any(${closedIds})`;
    await insertTickets(1, new Date("2026-10-30T09:00:00.000Z"), "NEWOPEN");

    expect(await readAllPages("?status=closed")).toEqual([...closedIds].reverse());
  });
});

async function closeTicket(id: number | string, cookie = agent) {
  const { POST } = await import("@/app/api/tickets/[id]/close/route");
  return POST(new Request(`http://localhost/api/tickets/${id}/close`, { method: "POST", headers: { cookie } }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

describe("createTicket (shared by form and webhook)", () => {
  it("returns the existing ticket for a repeated message id instead of creating another", async () => {
    const { createTicket } = await import("@/lib/tickets");
    const input = {
      customerEmail: "x@example.com",
      subject: "Hi",
      body: "first",
      source: "webhook" as const,
      externalMessageId: "<dup@example.com>",
    };

    const first = await createTicket(input);
    const again = await createTicket({ ...input, body: "changed" });

    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, ticket: { id: first.ticket.id, body: "first" } });
    expect((await (await listTickets("")).json()).tickets).toHaveLength(1);
  });
});

describe("ticket detail and close", () => {
  it("any agent can close a ticket, even one assigned to someone else", async () => {
    const [id] = await insertTickets(1);
    await sql`update tickets set assignee_id = (select id from users where email = 'ben@sift.local') where id = ${id}`;

    const res = await closeTicket(id);

    expect(res.status).toBe(200);
    const detail = await (await getTicket(id)).json();
    expect(detail.ticket).toMatchObject({ status: "closed", assignee: { name: "Ben Agent" } });
    const open = await (await listTickets("?status=open")).json();
    expect(open.tickets).toEqual([]);
  });

  it("returns 404 for an unknown or malformed ticket id", async () => {
    expect((await closeTicket(999999)).status).toBe(404);
    expect((await closeTicket("abc")).status).toBe(404);
    expect((await getTicket(999999)).status).toBe(404);
  });

  it("refuses anonymous close with 401 and leaves the ticket open", async () => {
    const [id] = await insertTickets(1);

    expect((await closeTicket(id, "")).status).toBe(401);
    expect((await (await getTicket(id)).json()).ticket.status).toBe("open");
  });
});

describe("create ticket from the form", () => {
  it("creates an open, unassigned ticket with source form that can then be opened", async () => {
    const res = await createViaForm({
      customerEmail: "pat@example.com",
      subject: "Card declined",
      body: "My card keeps getting declined at checkout.",
    });

    expect(res.status).toBe(201);
    const { ticket } = await res.json();
    const detail = await getTicket(ticket.id);
    expect(detail.status).toBe(200);
    expect((await detail.json()).ticket).toMatchObject({
      id: ticket.id,
      customerEmail: "pat@example.com",
      subject: "Card declined",
      body: "My card keeps getting declined at checkout.",
      source: "form",
      status: "open",
      assignee: null,
      triage: null,
    });
  });

  it("returns field errors for invalid input and creates nothing", async () => {
    const res = await createViaForm({ customerEmail: "not-an-email", subject: "   ", body: "" });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(Object.keys(json.fields).sort()).toEqual(["body", "customerEmail", "subject"]);
    expect(json.fields.customerEmail).toMatch(/valid email/i);
    const list = await (await listTickets("")).json();
    expect(list.tickets).toEqual([]);
  });

  it("rejects an anonymous request with 401", async () => {
    const res = await createViaForm({ customerEmail: "a@b.co", subject: "s", body: "b" }, "");

    expect(res.status).toBe(401);
  });
});
