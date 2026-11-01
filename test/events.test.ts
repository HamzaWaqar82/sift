import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { subscribe, type SiftEvent } from "@/lib/events";
import { giveTicketTo, seedTestUsers, signInAs } from "./helpers";

const SECRET = "test-webhook-secret";
process.env.WEBHOOK_SECRET = SECRET;

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const sample = JSON.parse(readFileSync("samples/live/01-export-failing-urgent.json", "utf8"));
let alice: string;
let admin: string;
let received: SiftEvent[];
let unsubscribe: () => void;

beforeAll(async () => {
  await seedTestUsers();
  alice = await signInAs("alice@sift.local");
  admin = await signInAs("admin@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  received = [];
  unsubscribe = await subscribe((e) => received.push(e));
});
afterEach(() => unsubscribe());
afterAll(async () => {
  await sql.end();
});

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

/** NOTIFY is delivered asynchronously; wait until a matching event arrives. */
async function eventOf(type: SiftEvent["type"], timeoutMs = 3000): Promise<SiftEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = received.find((e) => e.type === type);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no ${type} event; got ${JSON.stringify(received)}`);
}

async function postWebhook(body: unknown) {
  const { POST } = await import("@/app/api/webhook/route");
  return POST(
    new Request("http://localhost/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
      body: JSON.stringify(body),
    }),
  );
}

async function newTicketId() {
  const res = await postWebhook(sample);
  return (await res.json()).ticket.id as number;
}

describe("event bus", () => {
  it("publishes ticket.created for a webhook ticket, with ids only and no customer text", async () => {
    const id = await newTicketId();
    const event = await eventOf("ticket.created");
    expect(event).toEqual({ type: "ticket.created", ticketId: id, status: "open", assigneeId: null });
    const json = JSON.stringify(received);
    expect(json).not.toContain(sample.subject);
    expect(json).not.toContain(sample.from.email);
  });

  it("publishes nothing for a duplicate webhook delivery", async () => {
    await newTicketId();
    await eventOf("ticket.created");
    received = [];
    await postWebhook(sample);
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toEqual([]);
  });

  it("publishes ticket.created for a form ticket", async () => {
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(
      new Request("http://localhost/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alice },
        body: JSON.stringify({ customerEmail: "c@example.com", subject: "Hi", body: "Help" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(await eventOf("ticket.created")).toMatchObject({ ticketId: (await res.json()).ticket.id });
  });

  it("publishes message.created naming the replier, and the status change", async () => {
    const id = await newTicketId();
    await giveTicketTo(id);
    const { POST } = await import("@/app/api/tickets/[id]/replies/route");
    const res = await POST(
      new Request(`http://localhost/api/tickets/${id}/replies`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alice },
        body: JSON.stringify({ body: "We are on it.", idempotencyKey: `k-${Date.now()}`, draftTriageId: null }),
      }),
      ctx(id),
    );
    expect(res.status).toBe(201);
    expect(await eventOf("message.created")).toMatchObject({
      ticketId: id,
      direction: "outbound",
      authorName: "Alice Agent",
    });
    expect(await eventOf("ticket.updated")).toEqual({ type: "ticket.updated", ticketId: id, status: "replied" });
    expect(JSON.stringify(received)).not.toContain("We are on it.");
  });

  it("publishes ticket.updated on close and reopen", async () => {
    const id = await newTicketId();
    const close = await import("@/app/api/tickets/[id]/close/route");
    const req = (path: string) => new Request(`http://localhost/api/tickets/${id}/${path}`, { method: "POST", headers: { cookie: admin } });
    expect((await close.POST(req("close"), ctx(id))).status).toBe(200);
    expect(await eventOf("ticket.updated")).toEqual({ type: "ticket.updated", ticketId: id, status: "closed" });
    received = [];
    const reopen = await import("@/app/api/tickets/[id]/reopen/route");
    expect((await reopen.POST(req("reopen"), ctx(id))).status).toBe(200);
    expect(await eventOf("ticket.updated")).toEqual({ type: "ticket.updated", ticketId: id, status: "open" });
  });

  it("publishes ticket.assigned and ticket.released on reassignment", async () => {
    const id = await newTicketId();
    const [{ id: aliceId }] = await sql`select id from users where email = 'alice@sift.local'`;
    const { POST } = await import("@/app/api/tickets/[id]/assign/route");
    const assign = (assigneeId: number | null) =>
      POST(
        new Request(`http://localhost/api/tickets/${id}/assign`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: admin },
          body: JSON.stringify({ assigneeId }),
        }),
        ctx(id),
      );
    expect((await assign(aliceId)).status).toBe(200);
    expect(await eventOf("ticket.assigned")).toEqual({ type: "ticket.assigned", ticketId: id, assigneeId: aliceId });
    expect((await assign(null)).status).toBe(200);
    expect(await eventOf("ticket.released")).toEqual({ type: "ticket.released", ticketId: id });
  });

  it("publishes note.created without the note text", async () => {
    const id = await newTicketId();
    const { POST } = await import("@/app/api/tickets/[id]/notes/route");
    const res = await POST(
      new Request(`http://localhost/api/tickets/${id}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alice },
        body: JSON.stringify({ body: "Customer is on the legacy plan." }),
      }),
      ctx(id),
    );
    expect(res.status).toBe(201);
    const [{ id: aliceId }] = await sql`select id from users where email = 'alice@sift.local'`;
    expect(await eventOf("note.created")).toMatchObject({ ticketId: id, authorId: aliceId });
    expect(JSON.stringify(received)).not.toContain("legacy plan");
  });
});

describe("GET /api/events", () => {
  it("requires a session", async () => {
    const { GET } = await import("@/app/api/events/route");
    expect((await GET(new Request("http://localhost/api/events"))).status).toBe(401);
  });

  it("streams events to a signed-in user without proxy buffering", async () => {
    const { GET } = await import("@/app/api/events/route");
    const abort = new AbortController();
    const res = await GET(new Request("http://localhost/api/events", { headers: { cookie: alice }, signal: abort.signal }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    // The first chunk confirms the stream is subscribed before we act.
    text += (await reader.read()).value;
    const id = await newTicketId();
    while (!text.includes("ticket.created")) text += (await reader.read()).value;
    abort.abort();
    const data = text.split("\n").find((l) => l.startsWith("data:") && l.includes("ticket.created"))!;
    expect(JSON.parse(data.slice(5))).toMatchObject({ type: "ticket.created", ticketId: id });
  });
});
