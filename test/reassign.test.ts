import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let agent: string;
let admin: string;

beforeAll(async () => {
  await seedTestUsers();
  agent = await signInAs("alice@sift.local");
  admin = await signInAs("admin@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
});
afterAll(async () => {
  await sql.end();
});

async function userId(email: string) {
  const [row] = await sql`select id from users where email = ${email}`;
  return row.id as number;
}

async function createTicket(cookie = agent) {
  const { POST } = await import("@/app/api/tickets/route");
  const res = await POST(
    new Request("http://localhost/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ customerEmail: "c@example.com", subject: "Help", body: "Please help" }),
    }),
  );
  return (await res.json()).ticket as { id: number; assigneeId: number | null };
}

async function assign(id: number | string, body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/tickets/[id]/assign/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return POST(
    new Request(`http://localhost/api/tickets/${id}/assign`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

async function detail(id: number) {
  const { GET } = await import("@/app/api/tickets/[id]/route");
  const res = await GET(new Request(`http://localhost/api/tickets/${id}`, { headers: { cookie: agent } }), {
    params: Promise.resolve({ id: String(id) }),
  });
  return (await res.json()).ticket;
}

async function listRow(id: number) {
  const { GET } = await import("@/app/api/tickets/route");
  const res = await GET(new Request("http://localhost/api/tickets", { headers: { cookie: agent } }));
  return (await res.json()).tickets.find((t: { id: number }) => t.id === id);
}

describe("reassign", () => {
  it("refuses an agent with 403 and changes nothing", async () => {
    const ticket = await createTicket();
    const res = await assign(ticket.id, { assigneeId: await userId("ben@sift.local") }, agent);

    expect(res.status).toBe(403);
    expect((await detail(ticket.id)).assignee).toBeNull();
  });

  it("lets an admin assign and then reassign; detail and list show the new assignee", async () => {
    const ticket = await createTicket();
    const ben = await userId("ben@sift.local");
    const chloe = await userId("chloe@sift.local");

    const first = await assign(ticket.id, { assigneeId: ben }, admin);
    expect(first.status).toBe(200);
    expect((await first.json()).ticket.assignee).toEqual({ id: ben, name: expect.any(String), email: "ben@sift.local" });

    const second = await assign(ticket.id, { assigneeId: chloe }, admin);
    expect(second.status).toBe(200);
    expect((await detail(ticket.id)).assignee.email).toBe("chloe@sift.local");
    expect((await listRow(ticket.id)).assignee.email).toBe("chloe@sift.local");
  });

  it("starts new tickets unassigned, even when an admin creates them", async () => {
    const ticket = await createTicket(admin);
    expect(ticket.assigneeId).toBeNull();
    expect((await detail(ticket.id)).assignee).toBeNull();
  });

  it("lets an admin unassign with null", async () => {
    const ticket = await createTicket();
    await assign(ticket.id, { assigneeId: await userId("ben@sift.local") }, admin);

    const res = await assign(ticket.id, { assigneeId: null }, admin);

    expect(res.status).toBe(200);
    expect((await detail(ticket.id)).assignee).toBeNull();
  });

  it("rejects an unknown user with 400 and keeps the current assignee", async () => {
    const ticket = await createTicket();
    await assign(ticket.id, { assigneeId: await userId("ben@sift.local") }, admin);

    const res = await assign(ticket.id, { assigneeId: 999999 }, admin);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown user");
    expect((await detail(ticket.id)).assignee.email).toBe("ben@sift.local");
  });

  it("returns 404 for an unknown ticket", async () => {
    const res = await assign(424242, { assigneeId: await userId("ben@sift.local") }, admin);
    expect(res.status).toBe(404);
  });

  it("returns 401 when not signed in and changes nothing", async () => {
    const ticket = await createTicket();
    const res = await assign(ticket.id, { assigneeId: await userId("ben@sift.local") });

    expect(res.status).toBe(401);
    expect((await detail(ticket.id)).assignee).toBeNull();
  });

  it("does not restrict other agents: a non-assignee can still work the ticket", async () => {
    const ticket = await createTicket();
    await assign(ticket.id, { assigneeId: await userId("ben@sift.local") }, admin);

    const { POST } = await import("@/app/api/tickets/[id]/close/route");
    const res = await POST(
      new Request(`http://localhost/api/tickets/${ticket.id}/close`, { method: "POST", headers: { cookie: agent } }),
      { params: Promise.resolve({ id: String(ticket.id) }) },
    );
    expect(res.status).toBe(200);
  });
});
