import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles } from "../scripts/seed.mjs";
import { runTriageJobs, seedTestUsers, signInAs } from "./helpers";

// The provider is the only fake. Real Gemini is never called.
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
  await sql`truncate ai_usage, jobs`;
  provider.mockReset();
});
afterAll(async () => {
  await sql.end();
});

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

async function newTicket() {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({
    customerEmail: "maria@example.com",
    subject: "Charged twice",
    body: "I was charged twice this month, please refund one.",
    source: "form",
  });
  return ticket.id;
}

/** POSTs a triage request, then lets the worker run any job it queued. */
async function postTriage(id: number, cookie = agent, body?: unknown) {
  const { POST } = await import("@/app/api/tickets/[id]/triage/route");
  const res = await POST(
    new Request(`http://localhost/api/tickets/${id}/triage`, {
      method: "POST",
      headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    ctx(id),
  );
  await runTriageJobs();
  return res;
}

async function readTriage(id: number) {
  const { GET } = await import("@/app/api/tickets/[id]/triage/route");
  return (await GET(new Request(`http://localhost/api/tickets/${id}/triage`, { headers: { cookie: agent } }), ctx(id))).json();
}

async function readTicket(id: number) {
  const { GET } = await import("@/app/api/tickets/[id]/route");
  return (await (await GET(new Request(`http://localhost/api/tickets/${id}`, { headers: { cookie: agent } }), ctx(id))).json())
    .ticket;
}

async function listBadges() {
  const { GET } = await import("@/app/api/tickets/route");
  const { tickets } = await (await GET(new Request("http://localhost/api/tickets", { headers: { cookie: agent } }))).json();
  return Object.fromEntries(tickets.map((t: { id: number; triage: unknown }) => [t.id, t.triage]));
}

async function sendReply(id: number, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/tickets/[id]/replies/route");
  return POST(
    new Request(`http://localhost/api/tickets/${id}/replies`, {
      method: "POST",
      headers: { cookie: agent, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), ...body }),
    }),
    ctx(id),
  );
}

const VALID = {
  category: "billing",
  urgency: "medium",
  draft: "Hi Maria, sorry about the duplicate charge. We have refunded it.",
  article_id: "duplicate-charges-and-refunds",
};

function modelReturnsOnce(output: unknown) {
  provider.mockResolvedValueOnce({ rawText: JSON.stringify(output), model: "fake-model" });
}

/** Output that fails validation: stored as a failed attempt at once. */
function modelFailsOnce() {
  provider.mockResolvedValueOnce({ rawText: "not json", model: "fake-model" });
}

/** A valid triage followed by a failed admin regenerate. Returns the ticket id and valid triage id. */
async function validThenFailedRegenerate() {
  const id = await newTicket();
  modelReturnsOnce(VALID);
  await postTriage(id);
  const first = await readTriage(id);
  modelFailsOnce();
  expect((await postTriage(id, admin, { force: true })).status).toBe(202);
  expect((await readTriage(id)).state.state).toBe("failed");
  return { id, validTriageId: first.triage.id as number };
}

describe("the current triage is the latest VALID result", () => {
  it("keeps prefilling the reply with the last valid draft after a failed regenerate", async () => {
    const { id, validTriageId } = await validThenFailedRegenerate();

    const json = await readTriage(id);

    // The panel may still show the failed attempt...
    expect(json.triage).toMatchObject({ status: "error" });
    // ...but the draft comes from the latest valid result.
    expect(json.draft).toBe(VALID.draft);
    expect(json.draftTriageId).toBe(validTriageId);
    const ticket = await readTicket(id);
    expect(ticket.currentTriage).toMatchObject({ id: validTriageId, draft: VALID.draft });
  });

  it("keeps the article panel on the last valid result after a failed regenerate", async () => {
    const { id } = await validThenFailedRegenerate();

    const ticket = await readTicket(id);

    expect(ticket.grounding.article.id).toBe("duplicate-charges-and-refunds");
  });

  it("keeps the list badges on the last valid result after a failed regenerate", async () => {
    const { id } = await validThenFailedRegenerate();

    expect((await listBadges())[id]).toEqual({ ok: true, category: "billing", urgency: "medium" });
  });

  it("returns the last valid result from cache when an agent asks again after a failed regenerate", async () => {
    const { id, validTriageId } = await validThenFailedRegenerate();

    const res = await postTriage(id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cached: true, triage: { id: validTriageId, status: "ok" } });
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe("edited flag is computed against the draft the agent saw", () => {
  it("records an unedited send of the old draft as unedited when an admin regenerated mid-compose", async () => {
    const id = await newTicket();
    modelReturnsOnce(VALID);
    await postTriage(id);
    const seen = await readTriage(id);
    // The admin regenerates while the agent is composing from the first draft.
    modelReturnsOnce({ ...VALID, draft: "Hi Maria, a regenerated draft." });
    expect((await postTriage(id, admin, { force: true })).status).toBe(202);

    const res = await sendReply(id, { body: seen.draft, draftTriageId: seen.draftTriageId });

    expect(res.status).toBe(201);
    expect((await res.json()).reply).toMatchObject({ aiDraft: VALID.draft, edited: false });
  });

  it("records no AI draft when the client says no draft was shown", async () => {
    const id = await newTicket();
    modelReturnsOnce(VALID);
    await postTriage(id);

    const res = await sendReply(id, { body: VALID.draft, draftTriageId: null });

    expect((await res.json()).reply).toMatchObject({ aiDraft: null, edited: true });
  });

  it("rejects a draft id from another ticket or a failed attempt with 400", async () => {
    const id = await newTicket();
    const other = await newTicket();
    modelReturnsOnce(VALID);
    await postTriage(other);
    const otherTriage = (await readTriage(other)).triage.id;
    modelFailsOnce();
    await postTriage(id);
    const failedTriage = (await readTriage(id)).triage.id;

    for (const draftTriageId of [otherTriage, failedTriage, 999999]) {
      const res = await sendReply(id, { body: "Hello", draftTriageId });
      expect(res.status).toBe(400);
    }
    const [{ count }] = await sql`select count(*)::int as count from replies`;
    expect(count).toBe(0);
  });
});
