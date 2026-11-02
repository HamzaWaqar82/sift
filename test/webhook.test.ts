import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTestUsers, signInAs } from "./helpers";

const SECRET = "test-webhook-secret";
process.env.WEBHOOK_SECRET = SECRET;

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const sample = JSON.parse(readFileSync("samples/live/01-export-failing-urgent.json", "utf8"));
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

async function post(body: unknown, headers: Record<string, string> = { "x-webhook-secret": SECRET }) {
  const { POST } = await import("@/app/api/webhook/route");
  return POST(
    new Request("http://localhost/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** Tickets as an agent sees them through the list API. */
async function listedTickets() {
  const { GET } = await import("@/app/api/tickets/route");
  const res = await GET(new Request("http://localhost/api/tickets", { headers: { cookie: agent } }));
  return (await res.json()).tickets as Array<{ id: number; subject: string; source: string; customerEmail: string }>;
}

describe("POST /api/webhook", () => {
  it("rejects a request without the secret header", async () => {
    const res = await post(sample, {});
    expect(res.status).toBe(401);
    expect(await listedTickets()).toHaveLength(0);
  });

  it.each([
    ["wrong value, same length", "test-webhook-secreX"],
    ["wrong value, different length", "nope"],
    ["the secret with a suffix", `${SECRET}x`],
  ])("rejects a wrong secret (%s)", async (_label, secret) => {
    const res = await post(sample, { "x-webhook-secret": secret });
    expect(res.status).toBe(401);
    expect(await listedTickets()).toHaveLength(0);
  });

  it("creates a webhook ticket from a sample email", async () => {
    const before = Date.now();
    const res = await post(sample);
    expect(res.status).toBe(201);
    const { ticket, created } = await res.json();
    expect(created).toBe(true);
    expect(ticket).toMatchObject({
      customerEmail: "marcus.reid@hollowayfoods.com",
      customerName: "Marcus Reid",
      subject: "URGENT: data export fails every time, payroll due today",
      source: "webhook",
      status: "open",
      externalMessageId: "<mr-live-01-export@hollowayfoods.com>",
    });
    expect(ticket.body).toContain("error E-EXP-504");
    // Server receive time, not the sender's received_at.
    const createdAt = new Date(ticket.createdAt).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before - 1000);
    expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await listedTickets()).map((t) => t.id)).toEqual([ticket.id]);
  });

  it("orders tickets by when the server received them, ignoring the sender's received_at", async () => {
    const first = await (await post({ ...sample, message_id: "<a@x>", received_at: "2099-01-01T00:00:00Z" })).json();
    const second = await (
      await post({ ...sample, subject: "Another question", message_id: "<b@x>", received_at: "2001-01-01T00:00:00Z" })
    ).json();

    expect((await listedTickets()).map((t) => t.id)).toEqual([second.ticket.id, first.ticket.id]);
  });

  it("accepts an email without received_at", async () => {
    const res = await post({ ...sample, received_at: undefined });
    expect(res.status).toBe(201);
  });

  it("rejects a body that is not JSON, with a reason", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/json/i);
    expect(await listedTickets()).toHaveLength(0);
  });

  it.each([
    ["missing message_id", { ...sample, message_id: undefined }, "message_id"],
    ["empty body", { ...sample, body: "   " }, "body"],
    ["from as a plain string", { ...sample, from: "marcus.reid@hollowayfoods.com" }, "from"],
    ["invalid sender email", { ...sample, from: { email: "not-an-email" } }, "from.email"],
    ["unparseable received_at", { ...sample, received_at: "yesterday" }, "received_at"],
    ["a JSON array", [sample], "payload"],
  ])("rejects an invalid payload (%s) and names the field", async (_label, body, field) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(Object.keys(json.fields)).toContain(field);
    expect(await listedTickets()).toHaveLength(0);
  });

  it("re-posting the same message id returns success without a second ticket", async () => {
    const first = await post(sample);
    expect(first.status).toBe(201);
    const { ticket } = await first.json();

    const again = await post({ ...sample, subject: "Edited on resend", body: "different" });
    expect(again.status).toBe(200);
    const json = await again.json();
    expect(json.created).toBe(false);
    expect(json.ticket.id).toBe(ticket.id);
    expect(json.ticket.subject).toBe(sample.subject);

    const listed = await listedTickets();
    expect(listed).toHaveLength(1);
    expect(listed[0].subject).toBe(sample.subject);
  });

  it("a follow-up from the same sender threads into the ticket through the shared ingest path", async () => {
    const { ticket } = await (await post(sample)).json();
    const res = await post({
      ...sample,
      subject: `Re: ${sample.subject}`,
      body: "Any update?",
      message_id: "<mr-live-01-followup@hollowayfoods.com>",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: false, ticket: { id: ticket.id } });
    expect(await listedTickets()).toHaveLength(1);
    expect((await sql`select count(*)::int as n from messages where ticket_id = ${ticket.id}`)[0].n).toBe(2);
  });

  it("is refused in production", async () => {
    process.env.APP_ENV = "production";
    try {
      expect((await post(sample)).status).toBe(404);
    } finally {
      delete process.env.APP_ENV;
    }
    expect(await listedTickets()).toHaveLength(0);
  });

  it("rejects a body over 64 KiB with 413", async () => {
    const res = await post({ ...sample, body: "x".repeat(70_000) });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/64 KiB/);
    expect(await listedTickets()).toHaveLength(0);
  });

  it("rejects an oversized streamed body that declares no length", async () => {
    const { POST } = await import("@/app/api/webhook/route");
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 10) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const res = await POST(
      new Request("http://localhost/api/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
        body: stream,
        // @ts-expect-error Node's fetch needs duplex for a stream body
        duplex: "half",
      }),
    );
    expect(res.status).toBe(413);
    expect(await listedTickets()).toHaveLength(0);
  });

  it("accepts a long email that stays under the limit", async () => {
    const res = await post({ ...sample, body: "y".repeat(50_000) });
    expect(res.status).toBe(201);
  });

  it("accepts both live demo samples as-is", async () => {
    for (const file of ["01-export-failing-urgent.json", "02-add-team-member.json"]) {
      const res = await post(readFileSync(`samples/live/${file}`, "utf8"));
      expect(res.status).toBe(201);
    }
    expect((await listedTickets()).map((t) => t.subject)).toEqual([
      "How do I add a new team member?",
      "URGENT: data export fails every time, payroll due today",
    ]);
  });

  it("rejects every request when the server has no secret configured", async () => {
    const saved = process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_SECRET;
    try {
      const res = await post(sample, { "x-webhook-secret": "" });
      expect(res.status).toBe(401);
    } finally {
      process.env.WEBHOOK_SECRET = saved;
    }
    expect(await listedTickets()).toHaveLength(0);
  });

  it("accepts a sender without a name", async () => {
    const res = await post({ ...sample, from: { email: "Someone@Example.com" } });
    expect(res.status).toBe(201);
    const { ticket } = await res.json();
    expect(ticket.customerEmail).toBe("someone@example.com");
    expect(ticket.customerName).toBeNull();
  });
});
