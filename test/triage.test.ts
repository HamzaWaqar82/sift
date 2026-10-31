import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles } from "../scripts/seed.mjs";
import { seedTestUsers, signInAs } from "./helpers";

// Seam 2: the single provider function is the only thing faked. Real Gemini is never called.
vi.mock("@/lib/triage/provider", () => ({ runTriageModel: vi.fn() }));
import { runTriageModel } from "@/lib/triage/provider";
const provider = vi.mocked(runTriageModel);

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let agent: string;

beforeAll(async () => {
  await seedTestUsers();
  await seedHelpArticles(process.env.DATABASE_URL!);
  agent = await signInAs("alice@sift.local");
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  await sql`truncate ai_usage`;
  provider.mockReset();
});
afterAll(async () => {
  await sql.end();
});

async function newTicket(body = "I was charged twice this month, please refund one.") {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({
    customerEmail: "maria@example.com",
    subject: "Charged twice",
    body,
    source: "form",
  });
  return ticket.id;
}

async function requestTriage(id: number, cookie = agent) {
  const { POST } = await import("@/app/api/tickets/[id]/triage/route");
  return POST(new Request(`http://localhost/api/tickets/${id}/triage`, { method: "POST", headers: { cookie } }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

async function readTriage(id: number, cookie = agent) {
  const { GET } = await import("@/app/api/tickets/[id]/triage/route");
  return GET(new Request(`http://localhost/api/tickets/${id}/triage`, { headers: { cookie } }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

function modelReturns(output: unknown) {
  provider.mockResolvedValue({
    rawText: typeof output === "string" ? output : JSON.stringify(output),
    model: "fake-model",
  });
}

const VALID = {
  category: "billing",
  urgency: "medium",
  draft: "Hi Maria, sorry about the duplicate charge. We have refunded it.",
  article_id: "duplicate-charges-and-refunds",
};

describe("AI triage", () => {
  it("returns and stores a valid result with category, urgency, draft and article", async () => {
    const id = await newTicket();
    modelReturns(VALID);

    const res = await requestTriage(id);

    expect(res.status).toBe(200);
    const { triage } = await res.json();
    expect(triage).toMatchObject({
      status: "ok",
      category: "billing",
      urgency: "medium",
      draft: VALID.draft,
      article: { id: "duplicate-charges-and-refunds" },
    });
    const later = await (await readTriage(id)).json();
    expect(later.triage).toMatchObject({ status: "ok", category: "billing", draft: VALID.draft });
    expect(later.draft).toBe(VALID.draft);
  });

  it("serves a stored valid result on later requests without calling the provider again", async () => {
    const id = await newTicket();
    modelReturns(VALID);
    await requestTriage(id);

    const again = await requestTriage(id, await signInAs("ben@sift.local"));

    expect(again.status).toBe(200);
    const json = await again.json();
    expect(json.cached).toBe(true);
    expect(json.triage).toMatchObject({ status: "ok", draft: VALID.draft });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("puts the ticket text and the help articles in the provider input", async () => {
    const id = await newTicket("Please refund the duplicate.");
    modelReturns(VALID);

    await requestTriage(id);

    const input = provider.mock.calls[0][0];
    expect(input.subject).toBe("Charged twice");
    expect(input.body).toBe("Please refund the duplicate.");
    expect(input.articles.map((a) => a.id)).toContain("duplicate-charges-and-refunds");
    expect(input.articles.length).toBeGreaterThanOrEqual(8);
  });

  it.each([
    ["malformed JSON", '{"category": "billing", "urgency": ', /not valid JSON/],
    ["a category outside the fixed list", JSON.stringify({ ...VALID, category: "refunds" }), /category/],
    ["an urgency outside the fixed list", JSON.stringify({ ...VALID, urgency: "critical" }), /urgency/],
    ["an empty draft", JSON.stringify({ ...VALID, draft: "   " }), /draft/],
    ["an unknown article id", JSON.stringify({ ...VALID, article_id: "made-up-article" }), /made-up-article/],
  ])("rejects %s: stores an error with the raw output and never shows a draft", async (_name, raw, message) => {
    const id = await newTicket();
    modelReturns(raw);

    const res = await requestTriage(id);

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.draft).toBeNull();
    expect(json.triage.status).toBe("error");
    expect(json.triage.error).toMatch(message);
    expect(json.triage.rawOutput).toBe(raw);
    expect(json.triage).not.toHaveProperty("draft");
    const later = await (await readTriage(id)).json();
    expect(later.triage).toMatchObject({ status: "error", rawOutput: raw });
    expect(later.draft).toBeNull();
  });

  it("accepts a result with no article (ungrounded draft)", async () => {
    const id = await newTicket();
    modelReturns({ ...VALID, article_id: null });

    const res = await requestTriage(id);

    expect(res.status).toBe(200);
    expect((await res.json()).triage).toMatchObject({ status: "ok", article: null });
  });

  it("stores a provider failure as an error", async () => {
    const id = await newTicket();
    provider.mockRejectedValue(new Error("503 Service Unavailable"));

    const res = await requestTriage(id);

    expect(res.status).toBe(502);
    const { triage } = await res.json();
    expect(triage.status).toBe("error");
    expect(triage.error).toMatch(/503 Service Unavailable/);
  });

  it("lets the agent retry after a failure, and the retry's valid result replaces the error", async () => {
    const id = await newTicket();
    provider.mockRejectedValueOnce(new Error("timeout"));
    await requestTriage(id);
    modelReturns(VALID);

    const retry = await requestTriage(id);

    expect(retry.status).toBe(200);
    expect((await retry.json()).cached).toBe(false);
    expect(provider).toHaveBeenCalledTimes(2);
    expect((await (await readTriage(id)).json()).triage).toMatchObject({ status: "ok", draft: VALID.draft });
  });

  it("shows no triage for a ticket that has not been triaged", async () => {
    const id = await newTicket();
    const json = await (await readTriage(id)).json();
    expect(json).toEqual({ triage: null, draft: null });
  });

  it("requires sign-in and an existing ticket", async () => {
    const id = await newTicket();
    expect((await requestTriage(id, "")).status).toBe(401);
    expect((await requestTriage(9999)).status).toBe(404);
    expect((await readTriage(9999)).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });
});
