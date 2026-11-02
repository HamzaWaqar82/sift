import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
type Name = "alice" | "ben" | "chloe" | "dev" | "admin";

beforeAll(async () => {
  await seedTestUsers();
  for (const name of ["alice", "ben", "chloe", "dev", "admin"] as Name[]) {
    cookies[name] = await signInAs(`${name}@sift.local`);
    ids[name] = (await sql`select id from users where email = ${`${name}@sift.local`}`)[0].id;
  }
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  await sql`update users set availability = 'away', last_assigned_at = null`;
});
afterAll(async () => {
  await sql.end();
});

const available = (...names: Name[]) =>
  sql`update users set availability = 'available' where id in ${sql(names.map((n) => ids[n]))}`;

/** Creates a form ticket through the real route, as alice, and returns its assignee id. */
async function newTicket(): Promise<number | null> {
  const { POST } = await import("@/app/api/tickets/route");
  const res = await POST(
    new Request("http://localhost/api/tickets", {
      method: "POST",
      headers: { cookie: cookies.alice, "content-type": "application/json" },
      body: JSON.stringify({ customerEmail: "c@example.com", customerName: "C", subject: "Help", body: "Please" }),
    }),
  );
  expect(res.status).toBe(201);
  const { ticket } = await res.json();
  return (await sql`select assignee_id from tickets where id = ${ticket.id}`)[0].assignee_id;
}

async function giveOpenTickets(name: Name, count: number) {
  for (let i = 0; i < count; i++) {
    await sql`insert into tickets (customer_email, subject, source, assignee_id)
              values ('x@example.com', 's', 'form', ${ids[name]})`;
  }
}

async function setAvailability(target: Name, as: Name, availability: string) {
  const { PUT } = await import("@/app/api/users/[id]/availability/route");
  return PUT(
    new Request(`http://localhost/api/users/${ids[target]}/availability`, {
      method: "PUT",
      headers: { cookie: cookies[as], "content-type": "application/json" },
      body: JSON.stringify({ availability }),
    }),
    { params: Promise.resolve({ id: String(ids[target]) }) },
  ) as Promise<Response>;
}

describe("auto-assignment on creation", () => {
  it("gives a new ticket to the available user with the fewest open tickets", async () => {
    await available("alice", "ben", "chloe");
    await giveOpenTickets("alice", 2);
    await giveOpenTickets("ben", 1);
    await giveOpenTickets("chloe", 3);
    expect(await newTicket()).toBe(ids.ben);
    const [row] = await sql`select assigned_by from tickets order by id desc limit 1`;
    expect(row.assigned_by).toBe("auto");
  });

  it("does not count closed tickets as load", async () => {
    await available("alice", "ben");
    await giveOpenTickets("alice", 1);
    await giveOpenTickets("ben", 2);
    await sql`update tickets set status = 'closed' where assignee_id = ${ids.ben}`;
    expect(await newTicket()).toBe(ids.ben);
  });

  it("breaks ties by whoever was assigned least recently, never-assigned first", async () => {
    await available("alice", "ben", "chloe");
    await sql`update users set last_assigned_at = now() - interval '1 hour' where id = ${ids.alice}`;
    await sql`update users set last_assigned_at = now() - interval '2 hours' where id = ${ids.ben}`;
    // chloe has never been assigned: she goes first, then ben, then alice.
    const order = [await newTicket(), await newTicket(), await newTicket()];
    expect(order).toEqual([ids.chloe, ids.ben, ids.alice]);
  });

  it("never picks an Away or deactivated user", async () => {
    await available("alice", "ben");
    await giveOpenTickets("alice", 5);
    await sql`update users set deactivated_at = now() where id = ${ids.ben}`;
    try {
      expect(await newTicket()).toBe(ids.alice);
    } finally {
      await sql`update users set deactivated_at = null where id = ${ids.ben}`;
    }
  });

  it("leaves the ticket in the pool when nobody is available", async () => {
    expect(await newTicket()).toBeNull();
  });

  it("assigns webhook tickets too", async () => {
    await available("dev");
    process.env.WEBHOOK_SECRET = "s3cret-for-tests";
    const { POST } = await import("@/app/api/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/webhook", {
        method: "POST",
        headers: { "x-webhook-secret": "s3cret-for-tests", "content-type": "application/json" },
        body: JSON.stringify({ from: { email: "w@example.com" }, subject: "Hi", body: "There", message_id: "<aa@x>" }),
      }),
    );
    expect(res.status).toBe(201);
    expect((await sql`select assignee_id from tickets`)[0].assignee_id).toBe(ids.dev);
  });
});

describe("availability", () => {
  it("lets an agent go Away, which stops new work but keeps their tickets", async () => {
    await available("alice", "ben");
    await giveOpenTickets("alice", 1);
    const res = await setAvailability("alice", "alice", "away");
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ id: ids.alice, availability: "away" });
    await giveOpenTickets("ben", 3);
    expect(await newTicket()).toBe(ids.ben);
    expect((await sql`select count(*)::int as n from tickets where assignee_id = ${ids.alice}`)[0].n).toBe(1);
  });

  it("lets an admin set anyone Away, but not an agent", async () => {
    await available("ben");
    expect((await setAvailability("ben", "alice", "away")).status).toBe(403);
    expect((await setAvailability("ben", "admin", "away")).status).toBe(200);
    expect((await sql`select availability from users where id = ${ids.ben}`)[0].availability).toBe("away");
  });

  it("rejects an unknown state", async () => {
    expect((await setAvailability("alice", "alice", "busy")).status).toBe(400);
  });

  it("shows the team's presence to every signed-in user", async () => {
    await available("alice");
    const { GET } = await import("@/app/api/team/route");
    const res = await GET(new Request("http://localhost/api/team", { headers: { cookie: cookies.ben } }));
    expect(res.status).toBe(200);
    const { team } = await res.json();
    expect(team).toContainEqual({ id: ids.alice, name: expect.any(String), availability: "available" });
    expect(team).toContainEqual({ id: ids.ben, name: expect.any(String), availability: "away" });
  });
});
