import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedHelpArticles } from "../scripts/seed.mjs";
import { giveTicketTo, runTriageJobs, seedTestUsers, signInAs } from "./helpers";

vi.mock("@/lib/triage/provider", () => ({ runTriageModel: vi.fn() }));
import { runTriageModel } from "@/lib/triage/provider";
const provider = vi.mocked(runTriageModel);

const SECRET = "test-webhook-secret-auto-triage";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

beforeAll(async () => {
  process.env.WEBHOOK_SECRET = SECRET;
  await seedTestUsers();
  await seedHelpArticles(process.env.DATABASE_URL!);
});
beforeEach(async () => {
  await sql`truncate tickets restart identity cascade`;
  await sql`truncate ai_usage, ai_calls, jobs restart identity`;
  provider.mockReset();
  provider.mockResolvedValue({
    rawText: JSON.stringify({ category: "billing", urgency: "medium", draft: "Hi, we have refunded it.", article_id: null }),
    model: "fake-model",
  });
});
afterAll(async () => {
  delete process.env.AI_DAILY_CAP;
  delete process.env.AI_MANUAL_RESERVE_PCT;
  await sql.end();
});

let seq = 0;
async function webhook() {
  const { POST } = await import("@/app/api/webhook/route");
  const res = await POST(
    new Request("http://localhost/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
      body: JSON.stringify({
        from: { email: "maria@example.com" },
        subject: "Charged twice",
        body: "I was charged twice this month.",
        message_id: `<auto-${++seq}@example.com>`,
      }),
    }),
  );
  return { res, id: (await res.json()).ticket.id as number };
}

async function triageCount(id: number) {
  const [row] = await sql`select count(*)::int as n from triage_results where ticket_id = ${id} and error is null`;
  return row.n as number;
}

describe("automatic triage on arrival", () => {
  it("a new ticket enqueues triage.auto, responds before any AI call, and is triaged by the worker", async () => {
    const { res, id } = await webhook();

    expect(res.status).toBe(201);
    expect(provider).not.toHaveBeenCalled();
    const [job] = await sql`select kind, priority, payload from jobs`;
    expect(job).toMatchObject({ kind: "triage.auto", priority: 0, payload: { ticketId: id, lane: "auto" } });

    await runTriageJobs();

    expect(provider).toHaveBeenCalledTimes(1);
    expect(await triageCount(id)).toBe(1);
    const [call] = await sql`select lane from ai_calls`;
    expect(call.lane).toBe("auto");
  });
});

describe("budget lanes", () => {
  let agent: string;
  beforeAll(async () => {
    agent = await signInAs("alice@sift.local");
  });

  async function click(id: number) {
    await giveTicketTo(id);
    const { POST } = await import("@/app/api/tickets/[id]/triage/route");
    const req = new Request(`http://localhost/api/tickets/${id}/triage`, { method: "POST", headers: { cookie: agent } });
    return POST(req, { params: Promise.resolve({ id: String(id) }) });
  }

  it("an agent's click goes ahead of queued automatic triage", async () => {
    process.env.AI_RPM_LIMIT = "1";
    try {
      const first = await webhook();
      const second = await webhook();
      expect((await click(second.id)).status).toBe(202);

      const { runDueJobs } = await import("@/lib/jobs");
      await runDueJobs(); // one slot this minute: the clicked ticket takes it

      expect(await triageCount(second.id)).toBe(1);
      expect(await triageCount(first.id)).toBe(0);
      const [call] = await sql`select lane, ticket_id from ai_calls`;
      expect(call).toMatchObject({ lane: "manual", ticket_id: second.id });
    } finally {
      process.env.AI_RPM_LIMIT = "1000";
    }
  });

  it("automatic triage stops at 100 - AI_MANUAL_RESERVE_PCT of the cap; manual clicks still run", async () => {
    process.env.AI_DAILY_CAP = "10";
    process.env.AI_MANUAL_RESERVE_PCT = "20";
    await sql`insert into ai_usage (day, calls) values (${new Date().toISOString().slice(0, 10)}, 8)`;
    const { id } = await webhook();

    await runTriageJobs();

    expect(provider).not.toHaveBeenCalled();
    const [state] = await sql`select state from ticket_triage where ticket_id = ${id}`;
    expect(state.state).toBe("daily_cap_reached");

    expect((await click(id)).status).toBe(202);
    await runTriageJobs();

    expect(await triageCount(id)).toBe(1);
    const [usage] = await sql`select calls from ai_usage`;
    expect(usage.calls).toBe(9);
  });
});

describe("customer replies", () => {
  it("a redelivered email or a new customer message never starts another AI call", async () => {
    const { id } = await webhook();
    await runTriageJobs();
    provider.mockClear();

    const { POST } = await import("@/app/api/webhook/route");
    await POST(
      new Request("http://localhost/api/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
        body: JSON.stringify({
          from: { email: "maria@example.com" },
          subject: "Charged twice",
          body: "Again",
          message_id: `<auto-${seq}@example.com>`,
        }),
      }),
    );
    await sql`insert into messages (ticket_id, direction, from_address, subject, body_text, occurred_at)
              values (${id}, 'inbound', 'maria@example.com', 'Re: Charged twice', 'Any news?', now() + interval '1 minute')`;
    await sql`update tickets set last_inbound_at = now() + interval '1 minute' where id = ${id}`;
    await runTriageJobs();

    expect(provider).not.toHaveBeenCalled();
    const [jobs] = await sql`select count(*)::int as n from jobs where kind like 'triage.%'`;
    expect(jobs.n).toBe(1);
  });
});
