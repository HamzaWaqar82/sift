import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs, giveTicketTo } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let agent: string;
let admin: string;
let ticketId: number;

beforeAll(async () => {
  await seedTestUsers();
  agent = await signInAs("alice@sift.local");
  admin = await signInAs("admin@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  const { createTicket } = await import("@/lib/tickets");
  ticketId = (
    await createTicket({ customerEmail: "c@example.com", subject: "S", body: "B", source: "form" })
  ).ticket.id;
  await giveTicketTo(ticketId);
});
afterAll(async () => {
  await sql.end();
});

const ctx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

async function close(id: number | string, cookie: string) {
  const { POST } = await import("@/app/api/tickets/[id]/close/route");
  return POST(new Request(`http://localhost/api/tickets/${id}/close`, { method: "POST", headers: { cookie } }), ctx(id));
}
async function reopen(id: number | string, cookie: string) {
  const { POST } = await import("@/app/api/tickets/[id]/reopen/route");
  return POST(new Request(`http://localhost/api/tickets/${id}/reopen`, { method: "POST", headers: { cookie } }), ctx(id));
}
async function reply(id: number, cookie: string) {
  const { POST } = await import("@/app/api/tickets/[id]/replies/route");
  return POST(
    new Request(`http://localhost/api/tickets/${id}/replies`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ body: "Thanks, sorted.", idempotencyKey: `key-${Math.random()}-${id}` }),
    }),
    ctx(id),
  );
}
const statusOf = async (id: number) => (await sql`select status from tickets where id = ${id}`)[0].status;

describe("close rule", () => {
  it("an agent cannot close a ticket with no sent reply (409 reply_required)", async () => {
    const res = await close(ticketId, agent);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("reply_required");
    expect(body.error).toMatch(/reply/i);
    expect(await statusOf(ticketId)).toBe("open");
  });

  it("an agent can close once a reply has been sent", async () => {
    expect((await reply(ticketId, agent)).status).toBe(201);
    const res = await close(ticketId, agent);
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.status).toBe("closed");
  });

  it("an admin can close without a reply", async () => {
    const res = await close(ticketId, admin);
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.status).toBe("closed");
  });

  it("closing an already-closed ticket is idempotent (even for an agent)", async () => {
    await close(ticketId, admin);
    const [{ updated_at: before }] = await sql`select updated_at from tickets where id = ${ticketId}`;
    const res = await close(ticketId, agent);
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.status).toBe("closed");
    const [{ updated_at: after }] = await sql`select updated_at from tickets where id = ${ticketId}`;
    expect(after).toEqual(before);
  });

  it("404s for unknown and malformed ids, 401 when signed out", async () => {
    expect((await close(9999, admin)).status).toBe(404);
    expect((await close("abc", admin)).status).toBe(404);
    expect((await close("99999999999999999999", admin)).status).toBe(404);
    expect((await close(ticketId, "")).status).toBe(401);
  });
});

describe("reopen", () => {
  it("reopens a closed ticket for agents and admins", async () => {
    await close(ticketId, admin);
    const res = await reopen(ticketId, agent);
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.status).toBe("open");

    await close(ticketId, admin);
    expect((await reopen(ticketId, admin)).status).toBe(200);
    expect(await statusOf(ticketId)).toBe("open");
  });

  it("an agent can close again only after a reply exists (reopen keeps replies)", async () => {
    await reply(ticketId, agent);
    await close(ticketId, agent);
    await reopen(ticketId, agent);
    expect((await close(ticketId, agent)).status).toBe(200);
  });

  it("409 not_closed for a ticket that is not closed; 404 unknown; 401 signed out", async () => {
    const res = await reopen(ticketId, agent);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_closed");
    expect((await reopen(9999, agent)).status).toBe(404);
    expect((await reopen("nope", agent)).status).toBe(404);
    expect((await reopen(ticketId, "")).status).toBe(401);
  });
});
