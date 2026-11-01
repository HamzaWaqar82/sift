import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles } from "../scripts/seed.mjs";
import { runTriageJobs, seedTestUsers, signInAs } from "./helpers";

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
  await sql`truncate ai_usage, ai_calls, jobs restart identity`;
  provider.mockReset();
  process.env.AI_DAILY_CAP = "450";
  process.env.AI_RPM_LIMIT = "12";
});
afterEach(() => {
  delete process.env.AI_MANUAL_RESERVE_PCT;
});
afterAll(async () => {
  process.env.AI_RPM_LIMIT = "1000";
  delete process.env.AI_DAILY_CAP;
  await sql.end();
});

const VALID = {
  category: "billing",
  urgency: "medium",
  draft: "Hi Maria, sorry about the duplicate charge. We have refunded it.",
  article_id: "duplicate-charges-and-refunds",
};

function modelReturns(output: unknown) {
  provider.mockResolvedValue({ rawText: JSON.stringify(output), model: "fake-model" });
}

async function newTicket() {
  const { createTicket } = await import("@/lib/tickets");
  const { ticket } = await createTicket({
    customerEmail: "maria@example.com",
    subject: "Charged twice",
    body: "I was charged twice this month.",
    source: "form",
  });
  return ticket.id;
}

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function postTriage(id: number) {
  const { POST } = await import("@/app/api/tickets/[id]/triage/route");
  return POST(new Request(`http://localhost/api/tickets/${id}/triage`, { method: "POST", headers: { cookie: agent } }), ctx(id));
}

async function readTriage(id: number) {
  const { GET } = await import("@/app/api/tickets/[id]/triage/route");
  return (await GET(new Request(`http://localhost/api/tickets/${id}/triage`, { headers: { cookie: agent } }), ctx(id))).json();
}

/** Fills the minute window with `n` calls made `agoMs` before `now`. */
async function pastCalls(n: number, at: Date) {
  for (let i = 0; i < n; i++) {
    await sql`insert into ai_calls (lane, model, outcome, started_at) values ('manual', 'fake-model', 'ok', ${at})`;
  }
}

describe("AI limiter", () => {
  it("allows AI_RPM_LIMIT calls in any 60 seconds, then says when the window frees a slot", async () => {
    const { reserveAiCall } = await import("@/lib/triage/limiter");
    process.env.AI_RPM_LIMIT = "3";
    const t0 = new Date("2026-11-01T10:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      expect((await reserveAiCall({ lane: "manual", now: new Date(t0.getTime() + i * 1000) })).ok).toBe(true);
    }

    const refused = await reserveAiCall({ lane: "manual", now: new Date(t0.getTime() + 5000) });

    expect(refused).toEqual({ ok: false, reason: "rate_limit", retryAt: new Date(t0.getTime() + 60_000) });
    expect((await reserveAiCall({ lane: "manual", now: new Date(t0.getTime() + 60_001) })).ok).toBe(true);
    const [{ calls }] = await sql`select calls from ai_usage`;
    expect(calls).toBe(4);
  });

  it("allows AI_DAILY_CAP calls per UTC day, then refuses until midnight UTC", async () => {
    const { reserveAiCall } = await import("@/lib/triage/limiter");
    process.env.AI_DAILY_CAP = "2";
    const late = new Date("2026-10-31T23:50:00Z");
    expect((await reserveAiCall({ lane: "manual", now: late })).ok).toBe(true);
    expect((await reserveAiCall({ lane: "manual", now: new Date(late.getTime() + 120_000) })).ok).toBe(true);

    const refused = await reserveAiCall({ lane: "manual", now: new Date(late.getTime() + 240_000) });

    expect(refused).toEqual({ ok: false, reason: "daily_cap", retryAt: new Date("2026-11-01T00:00:00Z") });
    expect((await reserveAiCall({ lane: "manual", now: new Date("2026-11-01T00:05:00Z") })).ok).toBe(true);
  });

  it("never overshoots under simultaneous reservations", async () => {
    const { reserveAiCall } = await import("@/lib/triage/limiter");
    process.env.AI_RPM_LIMIT = "4";
    const now = new Date();

    const results = await Promise.all(Array.from({ length: 10 }, () => reserveAiCall({ lane: "manual", now })));

    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(await sql`select 1 from ai_calls`).toHaveLength(4);
  });

  it("keeps AI_MANUAL_RESERVE_PCT of the daily cap for manual triage", async () => {
    const { reserveAiCall } = await import("@/lib/triage/limiter");
    process.env.AI_DAILY_CAP = "10";
    process.env.AI_MANUAL_RESERVE_PCT = "20";
    const now = new Date();
    for (let i = 0; i < 8; i++) expect((await reserveAiCall({ lane: "auto", now })).ok).toBe(true);

    expect((await reserveAiCall({ lane: "auto", now })).ok).toBe(false);
    expect((await reserveAiCall({ lane: "manual", now })).ok).toBe(true);
  });
});

describe("manual triage job", () => {
  it("enqueues a high-priority triage.manual job and answers 202 queued; the job completes it", async () => {
    const id = await newTicket();
    modelReturns(VALID);

    const res = await postTriage(id);

    expect(res.status).toBe(202);
    expect((await res.json()).state).toEqual({ state: "queued", retryAt: null });
    const [job] = await sql`select kind, priority, payload from jobs`;
    expect(job.kind).toBe("triage.manual");
    expect(job.priority).toBeGreaterThan(0);
    expect(job.payload).toMatchObject({ ticketId: id, lane: "manual" });
    expect(provider).not.toHaveBeenCalled();

    await runTriageJobs();

    const later = await readTriage(id);
    expect(later.state.state).toBe("done");
    expect(later.triage).toMatchObject({ status: "ok", draft: VALID.draft });
  });

  it("does not enqueue a second job while one is pending", async () => {
    const id = await newTicket();
    await postTriage(id);
    await postTriage(id);
    expect(await sql`select 1 from jobs`).toHaveLength(1);
  });

  it("publishes triage.updated as the state changes", async () => {
    const { subscribe } = await import("@/lib/events");
    const seen: string[] = [];
    const stop = await subscribe((e) => {
      if (e.type === "triage.updated" || e.type === "ai_budget.updated") seen.push(e.type);
    });
    const id = await newTicket();
    modelReturns(VALID);
    await postTriage(id);
    await runTriageJobs();
    await new Promise((r) => setTimeout(r, 200));
    stop();
    expect(seen).toContain("triage.updated");
    expect(seen).toContain("ai_budget.updated");
  });

  it("waits on our per-minute limit: requeued with its retry time, nothing called or stored as failed", async () => {
    process.env.AI_RPM_LIMIT = "2";
    const oldest = new Date(Date.now() - 30_000);
    await pastCalls(2, oldest);
    const id = await newTicket();
    modelReturns(VALID);

    await postTriage(id);
    await runTriageJobs();

    expect(provider).not.toHaveBeenCalled();
    const { state, triage } = await readTriage(id);
    expect(state.state).toBe("waiting_rate_limit");
    expect(new Date(state.retryAt).getTime()).toBe(oldest.getTime() + 60_000);
    expect(triage).toBeNull();
    const [job] = await sql`select status, attempts, run_at from jobs`;
    expect(job).toMatchObject({ status: "queued", attempts: 0 });
    expect(job.run_at.getTime()).toBe(oldest.getTime() + 60_000);
  });

  it("shows Daily AI limit reached with a retry at midnight UTC when the cap is used up", async () => {
    process.env.AI_DAILY_CAP = "0";
    const id = await newTicket();

    await postTriage(id);
    await runTriageJobs();

    const { state } = await readTriage(id);
    expect(state.state).toBe("daily_cap_reached");
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    expect(new Date(state.retryAt).getTime()).toBe(tomorrow.getTime());
    expect(provider).not.toHaveBeenCalled();
  });

  it("requeues a Gemini 429 honouring Retry-After, never as a failure, then succeeds", async () => {
    const { AiRateLimitedError } = await import("@/lib/triage/errors");
    const id = await newTicket();
    provider.mockRejectedValueOnce(new AiRateLimitedError("429 RESOURCE_EXHAUSTED", 42));
    modelReturns(VALID);

    const before = Date.now();
    await postTriage(id);
    await runTriageJobs();

    const waiting = await readTriage(id);
    expect(waiting.state.state).toBe("waiting_rate_limit");
    const retryAt = new Date(waiting.state.retryAt).getTime();
    expect(retryAt).toBeGreaterThanOrEqual(before + 42_000);
    expect(retryAt).toBeLessThan(Date.now() + 43_000);
    expect(waiting.triage).toBeNull();
    const [job] = await sql`select status, attempts from jobs`;
    expect(job).toMatchObject({ status: "queued", attempts: 0 });
    const [call] = await sql`select outcome from ai_calls`;
    expect(call.outcome).toBe("rate_limited");

    await sql`update jobs set run_at = now()`;
    await runTriageJobs();

    expect((await readTriage(id)).state.state).toBe("done");
  });

  it("ends as Failed after the provider keeps erroring, and a retry click can fix it", async () => {
    const id = await newTicket();
    provider.mockRejectedValue(new Error("503 Service Unavailable"));

    await postTriage(id);
    await runTriageJobs();

    const failed = await readTriage(id);
    expect(failed.state.state).toBe("failed");
    expect(failed.triage).toMatchObject({ status: "error" });
    expect(failed.triage.error).toMatch(/503/);
    expect(provider).toHaveBeenCalledTimes(3);
    expect((await sql`select status from jobs`)[0].status).toBe("failed");

    modelReturns(VALID);
    expect((await postTriage(id)).status).toBe(202);
    await runTriageJobs();
    expect((await readTriage(id)).state.state).toBe("done");
  });

  it("marks a triage Out of date once the customer writes again, and lets an agent re-triage it", async () => {
    const id = await newTicket();
    modelReturns(VALID);
    await postTriage(id);
    await runTriageJobs();
    await sql`update tickets set last_inbound_at = now() + interval '1 minute' where id = ${id}`;

    expect((await readTriage(id)).state.state).toBe("superseded");
    expect((await postTriage(id)).status).toBe(202);
  });
});

describe("AI budget chip", () => {
  it("reports today's use, the queue, amber near the cap and a pause while the minute window is full", async () => {
    const { aiBudget } = await import("@/lib/triage");
    process.env.AI_DAILY_CAP = "10";
    process.env.AI_RPM_LIMIT = "8";
    const oldest = new Date(Date.now() - 10_000);
    await pastCalls(8, oldest);
    await sql`insert into ai_usage (day, calls) values (${new Date().toISOString().slice(0, 10)}, 8)`;
    await postTriage(await newTicket());

    const budget = await aiBudget();

    expect(budget).toMatchObject({ used: 8, cap: 10, queued: 1, nearCap: true });
    expect(budget.pausedUntil?.getTime()).toBe(oldest.getTime() + 60_000);
  });
});
