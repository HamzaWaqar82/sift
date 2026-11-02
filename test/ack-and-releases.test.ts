import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { subscribe, type SiftEvent } from "@/lib/events";
import { seedTestUsers, signInAs, skipAutoTriage } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const ids: Record<string, number> = {};
type Name = "alice" | "ben" | "admin";

beforeAll(async () => {
  await seedTestUsers();
  for (const name of ["alice", "ben", "admin"] as Name[]) {
    ids[name] = (await sql`select id from users where email = ${`${name}@sift.local`}`)[0].id;
  }
});
beforeEach(async () => {
  await sql`truncate tickets, jobs, audit_log restart identity cascade`;
  await seedTestUsers();
});
afterAll(async () => {
  await sql.end();
});

const available = (...names: Name[]) =>
  sql`update users set availability = 'available' where id in ${sql(names.map((n) => ids[n]))}`;

/** A new form ticket, auto-assigned as on creation. */
async function newTicket() {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({ customerEmail: "c@example.com", subject: "Help", body: "Please", source: "form" });
  await skipAutoTriage(ticket.id);
  return ticket.id;
}

/** Schedules the recurring sweeps (as the worker does on start) and runs everything due. */
async function sweep() {
  const { ensureRecurringJobs, runDueJobs } = await import("@/lib/jobs");
  await ensureRecurringJobs();
  await sql`update jobs set run_at = now() where status = 'queued'`;
  return runDueJobs();
}

const age = (id: number, minutes = 241) =>
  sql`update tickets set assigned_at = now() - ${minutes} * interval '1 minute' where id = ${id}`;
const customerWaited = (id: number, hours: number) =>
  sql`update tickets set last_inbound_at = now() - ${hours} * interval '1 hour' where id = ${id}`;

async function open(id: number, as: Name) {
  const { GET } = await import("@/app/api/tickets/[id]/route");
  const cookie = await signInAs(`${as}@sift.local`);
  const res = await GET(new Request(`http://localhost/api/tickets/${id}`, { headers: { cookie } }), {
    params: Promise.resolve({ id: String(id) }),
  });
  expect(res.status).toBe(200);
}

const ticketRow = async (id: number) => (await sql`select * from tickets where id = ${id}`)[0];

describe("ack timeout", () => {
  it("moves an auto-assigned ticket nobody opened to the next candidate", async () => {
    await available("alice");
    const id = await newTicket();
    expect((await ticketRow(id)).assignee_id).toBe(ids.alice);
    await available("ben");
    await age(id);

    await sweep();

    const row = await ticketRow(id);
    expect(row.assignee_id).toBe(ids.ben);
    expect(row.assigned_by).toBe("auto");
    expect(row.released_from_user_id).toBe(ids.alice);
    const audit = await sql`select action, target_user_id from audit_log where ticket_id = ${id}`;
    expect(audit).toEqual([{ action: "ticket_released", target_user_id: ids.alice }]);
  });

  it("leaves a ticket its owner opened, and pools one when nobody else is available", async () => {
    await available("alice");
    const opened = await newTicket();
    const unopened = await newTicket();
    await open(opened, "alice");
    await open(unopened, "ben"); // someone else looking doesn't count
    await age(opened);
    await age(unopened);

    await sweep();

    expect((await ticketRow(opened)).assignee_id).toBe(ids.alice);
    const pooled = await ticketRow(unopened);
    expect(pooled.assignee_id).toBeNull();
    expect(pooled.assigned_by).toBe("system");
  });

  it("waits ACK_TIMEOUT_MINUTES (default 240)", async () => {
    await available("alice", "ben");
    const id = await newTicket();
    await age(id, 239);
    await sweep();
    expect((await ticketRow(id)).released_from_user_id).toBeNull();
  });
});

describe("overdue sweep", () => {
  it("marks an overdue ticket and releases it to the pool, with an audit row and events", async () => {
    await available("alice");
    const id = await newTicket();
    const fresh = await newTicket();
    await customerWaited(id, 25);
    const events: SiftEvent[] = [];
    const stop = await subscribe((e) => events.push(e));

    await sweep();
    stop();

    const row = await ticketRow(id);
    expect(row.overdue_since).not.toBeNull();
    expect(row.assignee_id).toBeNull();
    expect(row.assigned_by).toBe("system");
    expect(row.release_reason).toBe("overdue");
    expect((await ticketRow(fresh)).assignee_id).toBe(ids.alice);
    expect(await sql`select action, actor_id from audit_log where ticket_id = ${id}`).toEqual([
      { action: "ticket_released", actor_id: null },
    ]);
    expect(events).toContainEqual({ type: "overdue.marked", ticketId: id });
    expect(events).toContainEqual({ type: "ticket.released", ticketId: id });
    const { getTicket } = await import("@/lib/tickets");
    expect((await getTicket(id))!.releasedFrom?.id).toBe(ids.alice);
  });

  it("releases a ticket once per wait, even if it is claimed again while still overdue", async () => {
    await available("alice");
    const id = await newTicket();
    await customerWaited(id, 25);
    await sweep();
    await sql`update tickets set assignee_id = ${ids.ben}, assigned_by = 'claim' where id = ${id}`;
    await sweep();
    expect((await ticketRow(id)).assignee_id).toBe(ids.ben);
  });
});

describe("deactivation", () => {
  it("releases the user's open tickets to the pool", async () => {
    await available("alice");
    const openTicket = await newTicket();
    const closed = await newTicket();
    await sql`update tickets set status = 'closed' where id = ${closed}`;
    const admin = await signInAs("admin@sift.local");

    const { POST } = await import("@/app/api/admin/users/[id]/deactivate/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/users/${ids.alice}/deactivate`, { method: "POST", headers: { cookie: admin } }),
      { params: Promise.resolve({ id: String(ids.alice) }) },
    );
    expect(res.status).toBe(200);

    const row = await ticketRow(openTicket);
    expect(row.assignee_id).toBeNull();
    expect(row.released_from_user_id).toBe(ids.alice);
    expect((await ticketRow(closed)).assignee_id).toBe(ids.alice);
  });
});
