import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles } from "../scripts/seed.mjs";
import { seedTestUsers, signInAs } from "./helpers";

// Seam 2: the single provider function is the only thing faked. Real Gemini is never called.
vi.mock("@/lib/triage/provider", () => ({ runTriageModel: vi.fn() }));
import { runTriageModel } from "@/lib/triage/provider";
const provider = vi.mocked(runTriageModel);

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let agent: string;
let admin: string;

beforeAll(async () => {
  await seedTestUsers();
  await seedHelpArticles(process.env.DATABASE_URL!);
  agent = await signInAs("alice@sift.local");
  admin = await signInAs("admin@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  await sql`truncate ai_usage`;
  provider.mockReset();
  process.env.AI_DAILY_CAP = "50";
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  delete process.env.AI_DAILY_CAP;
  await sql.end();
});

async function newTicket(subject = "Charged twice", body = "I was charged twice this month, please refund one.") {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({ customerEmail: "maria@example.com", subject, body, source: "form" });
  return ticket.id;
}

async function postTriage(id: number, cookie = agent, body?: unknown) {
  const { POST } = await import("@/app/api/tickets/[id]/triage/route");
  return POST(
    new Request(`http://localhost/api/tickets/${id}/triage`, {
      method: "POST",
      headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

async function readTriage(id: number, cookie = agent) {
  const { GET } = await import("@/app/api/tickets/[id]/triage/route");
  return GET(new Request(`http://localhost/api/tickets/${id}/triage`, { headers: { cookie } }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

async function sendReply(id: number, text: string, cookie = agent) {
  const { POST } = await import("@/app/api/tickets/[id]/replies/route");
  return POST(
    new Request(`http://localhost/api/tickets/${id}/replies`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ body: text, idempotencyKey: crypto.randomUUID() }),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

const VALID = {
  category: "billing",
  urgency: "medium",
  draft: "Hi Maria, sorry about the duplicate charge. We have refunded it.",
  article_id: "duplicate-charges-and-refunds",
};

function modelReturns(output: unknown) {
  provider.mockResolvedValue({ rawText: JSON.stringify(output), model: "fake-model" });
}

describe("daily AI cap", () => {
  it("refuses triage with 429 and a clear message once the day's cap is reached, without calling the provider", async () => {
    process.env.AI_DAILY_CAP = "2";
    modelReturns(VALID);
    const [a, b, c] = [await newTicket(), await newTicket(), await newTicket()];
    expect((await postTriage(a)).status).toBe(200);
    expect((await postTriage(b)).status).toBe(200);

    const res = await postTriage(c);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/daily AI limit/i);
    expect(json.error).toMatch(/manually/i);
    expect(provider).toHaveBeenCalledTimes(2);
    expect((await (await readTriage(c)).json()).triage).toBeNull();
  });

  it("allows triage again on the next UTC day", async () => {
    process.env.AI_DAILY_CAP = "1";
    modelReturns(VALID);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T23:50:00Z"));
    const [a, b] = [await newTicket(), await newTicket()];
    expect((await postTriage(a)).status).toBe(200);
    expect((await postTriage(b)).status).toBe(429);

    vi.setSystemTime(new Date("2026-11-01T00:05:00Z"));
    const res = await postTriage(b);

    expect(res.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("does not count cached results against the cap", async () => {
    process.env.AI_DAILY_CAP = "1";
    modelReturns(VALID);
    const id = await newTicket();
    await postTriage(id);

    const again = await postTriage(id, await signInAs("ben@sift.local"));

    expect(again.status).toBe(200);
    expect((await again.json()).cached).toBe(true);
  });

  it("still lets an agent reply when the cap is reached", async () => {
    process.env.AI_DAILY_CAP = "0";
    const id = await newTicket();
    expect((await postTriage(id)).status).toBe(429);

    const res = await sendReply(id, "Hi Maria, we have refunded the duplicate charge.");

    expect(res.status).toBe(201);
  });
});

describe("redaction before the provider", () => {
  it("removes email addresses and phone numbers from the subject and body sent to the provider", async () => {
    modelReturns(VALID);
    const id = await newTicket(
      "Call me on +44 7700 900123 or mail maria.lopez@gmail.com",
      [
        "Hi, my personal address is Maria.Lopez+billing@Example.co.uk and my work one is m.lopez@acme-corp.io.",
        "Phone (415) 555-0132 or 020 7946 0958, mobile +1-202-555-0175.",
        "Invoice INV-2026-0042 for $49.00 on 2026-10-31, order 12345.",
      ].join("\n"),
    );

    await postTriage(id);

    const input = provider.mock.calls[0][0];
    const sent = `${input.subject}\n${input.body}`;
    for (const secret of [
      "maria.lopez@gmail.com",
      "Maria.Lopez+billing@Example.co.uk",
      "m.lopez@acme-corp.io",
      "7700 900123",
      "(415) 555-0132",
      "020 7946 0958",
      "202-555-0175",
    ]) {
      expect(sent).not.toContain(secret);
    }
    expect(input.subject).toBe("Call me on [phone removed] or mail [email removed]");
    expect(input.body).toContain("[email removed]");
    expect(input.body).toContain("[phone removed]");
    // Ordinary numbers and dates survive so the model keeps the context.
    expect(input.body).toContain("Invoice INV-2026-0042 for $49.00 on 2026-10-31, order 12345.");
  });

  it("stores the ticket text unchanged for the agent", async () => {
    modelReturns(VALID);
    const id = await newTicket("Help", "Reach me at maria@example.com");
    await postTriage(id);

    const { getTicket } = await import("@/lib/tickets");
    expect((await getTicket(id))!.body).toBe("Reach me at maria@example.com");
  });
});

describe("regenerate (admin only)", () => {
  it("refuses an agent with 403, calls nothing and keeps the stored result", async () => {
    modelReturns(VALID);
    const id = await newTicket();
    await postTriage(id);

    const res = await postTriage(id, agent, { force: true });

    expect(res.status).toBe(403);
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await (await readTriage(id)).json()).triage).toMatchObject({ status: "ok", draft: VALID.draft });
  });

  it("lets an admin regenerate: a new provider call replaces the stored valid result", async () => {
    modelReturns(VALID);
    const id = await newTicket();
    await postTriage(id);
    modelReturns({ ...VALID, urgency: "high", draft: "Hi Maria, a regenerated draft." });

    const res = await postTriage(id, admin, { force: true });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(false);
    expect(json.triage).toMatchObject({ status: "ok", urgency: "high", draft: "Hi Maria, a regenerated draft." });
    expect(provider).toHaveBeenCalledTimes(2);
    const later = await (await readTriage(id)).json();
    expect(later.triage).toMatchObject({ urgency: "high" });
    expect(later.draft).toBe("Hi Maria, a regenerated draft.");
  });

  it("counts a regenerate against the daily cap", async () => {
    process.env.AI_DAILY_CAP = "1";
    modelReturns(VALID);
    const id = await newTicket();
    await postTriage(id);

    const res = await postTriage(id, admin, { force: true });

    expect(res.status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed request body with 400", async () => {
    const id = await newTicket();
    expect((await postTriage(id, admin, { force: "yes" })).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("list badges", () => {
  it("lists category and urgency for tickets whose latest triage is valid", async () => {
    modelReturns(VALID);
    const [triaged, failed, plain] = [await newTicket(), await newTicket(), await newTicket()];
    await postTriage(triaged);
    provider.mockRejectedValueOnce(new Error("timeout"));
    await postTriage(failed);

    const { GET } = await import("@/app/api/tickets/route");
    const res = await GET(new Request("http://localhost/api/tickets", { headers: { cookie: agent } }));
    const { tickets } = (await res.json()) as { tickets: { id: number; triage: unknown }[] };
    const byId = Object.fromEntries(tickets.map((t) => [t.id, t.triage]));

    expect(byId[triaged]).toEqual({ ok: true, category: "billing", urgency: "medium" });
    expect(byId[failed]).toEqual({ ok: false });
    expect(byId[plain]).toBeNull();
  });
});
