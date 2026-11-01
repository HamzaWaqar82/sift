import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles } from "../scripts/seed.mjs";
import { seedTestUsers, signInAs } from "./helpers";

vi.mock("@/lib/triage/provider", () => ({ runTriageModel: vi.fn() }));
import { runTriageModel } from "@/lib/triage/provider";
const provider = vi.mocked(runTriageModel);

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
let ticketId: number;

beforeAll(async () => {
  await seedTestUsers();
  await seedHelpArticles(process.env.DATABASE_URL!);
  for (const name of ["alice", "ben", "admin"]) {
    cookies[name] = await signInAs(`${name}@sift.local`);
    ids[name] = (await sql`select id from users where email = ${`${name}@sift.local`}`)[0].id;
  }
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  await sql`truncate ai_usage`;
  provider.mockReset();
  provider.mockResolvedValue({
    rawText: JSON.stringify({ category: "billing", urgency: "low", draft: "Hi, sorted.", article_id: null }),
    model: "fake-model",
  });
  const { createTicket } = await import("@/lib/tickets");
  ticketId = (await createTicket({ customerEmail: "c@example.com", subject: "S", body: "B", source: "form" })).ticket.id;
});
afterAll(async () => {
  await sql.end();
});

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function call(path: "replies" | "triage" | "close" | "reopen" | "claim" | "release", cookie: string, body?: unknown) {
  const mod = await import(`@/app/api/tickets/[id]/${path}/route`);
  return mod.POST(
    new Request(`http://localhost/api/tickets/${ticketId}/${path}`, {
      method: "POST",
      headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx(ticketId),
  ) as Promise<Response>;
}

const reply = (cookie: string) => call("replies", cookie, { body: "Thanks, sorted.", idempotencyKey: `k-${Math.random()}` });
const own = (name: "alice" | null) => sql`update tickets set assignee_id = ${name ? ids[name] : null} where id = ${ticketId}`;
const ticketRow = async () => (await sql`select * from tickets where id = ${ticketId}`)[0];

/** Who is acting relative to the ticket: alice owns it, ben is another agent, or nobody owns it. */
type Role = "owner" | "other agent" | "unassigned" | "admin";
async function actAs(role: Role): Promise<string> {
  await own(role === "unassigned" ? null : "alice");
  return cookies[role === "owner" || role === "unassigned" ? "alice" : role === "admin" ? "admin" : "ben"];
}

type Expect = number | [number, string];
function check(res: Response, want: Expect) {
  const [status, code] = Array.isArray(want) ? want : [want, undefined];
  expect(res.status).toBe(status);
  return code ? res.json().then((b) => expect(b.code).toBe(code)) : undefined;
}

// One row per capability in scope; columns follow the spec's matrix.
const MATRIX: { capability: string; run: (cookie: string) => Promise<Response>; setup?: () => Promise<unknown>; expect: Record<Role, Expect> }[] = [
  {
    capability: "send reply",
    run: reply,
    expect: { owner: 201, "other agent": [403, "not_ticket_owner"], unassigned: [409, "ticket_unassigned"], admin: 201 },
  },
  {
    capability: "request triage",
    run: (c) => call("triage", c),
    expect: { owner: 200, "other agent": [403, "not_ticket_owner"], unassigned: [409, "ticket_unassigned"], admin: 200 },
  },
  {
    capability: "regenerate triage",
    run: (c) => call("triage", c, { force: true }),
    expect: { owner: [403, "forbidden"], "other agent": [403, "forbidden"], unassigned: [403, "forbidden"], admin: 200 },
  },
  {
    capability: "close (after a sent reply)",
    setup: () => reply(cookies.admin),
    run: (c) => call("close", c),
    expect: { owner: 200, "other agent": [403, "not_ticket_owner"], unassigned: [409, "ticket_unassigned"], admin: 200 },
  },
  {
    capability: "reopen",
    setup: () => sql`update tickets set status = 'closed' where id = ${ticketId}`,
    run: (c) => call("reopen", c),
    expect: { owner: 200, "other agent": 200, unassigned: 200, admin: 200 },
  },
  {
    capability: "claim",
    run: (c) => call("claim", c),
    // The owner claiming again is a no-op; someone else's ticket cannot be claimed.
    expect: { owner: 200, "other agent": [409, "already_claimed"], unassigned: 200, admin: [409, "already_claimed"] },
  },
  {
    capability: "release",
    run: (c) => call("release", c),
    expect: { owner: 200, "other agent": [403, "not_ticket_owner"], unassigned: [409, "ticket_unassigned"], admin: 200 },
  },
];

describe("permission matrix", () => {
  for (const row of MATRIX) {
    it.each(["owner", "other agent", "unassigned", "admin"] as Role[])(`${row.capability}: %s`, async (role) => {
      await row.setup?.();
      const cookie = await actAs(role);
      await check(await row.run(cookie), row.expect[role]);
    });
  }

  it("a refused send records nothing", async () => {
    await actAs("other agent");
    await reply(cookies.ben);
    expect(await sql`select 1 from messages where ticket_id = ${ticketId} and direction = 'outbound'`).toHaveLength(0);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("claim", () => {
  it("makes the claimer the owner, recorded as a claim", async () => {
    const res = await call("claim", cookies.ben);
    expect((await res.json()).ticket.assignee).toMatchObject({ id: ids.ben, name: expect.any(String) });
    expect(await ticketRow()).toMatchObject({ assignee_id: ids.ben, assigned_by: "claim" });
  });

  it("two concurrent claims: exactly one wins, the loser learns who", async () => {
    const results = await Promise.all([call("claim", cookies.alice), call("claim", cookies.ben)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = await results.find((r) => r.status === 409)!.json();
    const winnerId = (await ticketRow()).assignee_id;
    expect(loser.code).toBe("already_claimed");
    expect(loser.owner.id).toBe(winnerId);
    expect(loser.error).toContain(loser.owner.name);
  });
});

describe("release", () => {
  it("returns the ticket to the pool and records who it came from", async () => {
    await own("alice");
    await sql`update tickets set assigned_by = 'claim' where id = ${ticketId}`;
    const res = await call("release", cookies.alice);
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.assignee).toBeNull();
    expect(await ticketRow()).toMatchObject({ assignee_id: null, assigned_by: null, released_from_user_id: ids.alice, release_reason: null });
    expect(await sql`select 1 from internal_notes where ticket_id = ${ticketId}`).toHaveLength(0);
  });

  it("an admin releasing someone's ticket records the owner, and a reason becomes a note", async () => {
    await own("alice");
    const res = await call("release", cookies.admin, { reason: "  Alice is out this week  " });
    expect(res.status).toBe(200);
    expect(await ticketRow()).toMatchObject({ released_from_user_id: ids.alice, release_reason: "Alice is out this week" });
    const notes = await sql`select author_id, body from internal_notes where ticket_id = ${ticketId}`;
    expect(notes).toEqual([{ author_id: ids.admin, body: expect.stringContaining("Alice is out this week") }]);
  });

  it("rejects an over-long reason", async () => {
    await own("alice");
    const res = await call("release", cookies.alice, { reason: "x".repeat(1001) });
    expect(res.status).toBe(400);
    expect((await ticketRow()).assignee_id).toBe(ids.alice);
  });
});
