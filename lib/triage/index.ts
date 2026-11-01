// AI triage for one ticket. A request enqueues a job (requestTriage); the worker makes the one
// provider call through the AI budget gate, re-validates strictly and stores it (runTriageJob).
// Every attempt is stored in triage_results. The ticket's CURRENT triage (draft, article, list
// badges, cache) is its latest valid result: getCurrentTriage in lib/tickets. The triage panel
// additionally shows the latest attempt, so a failed attempt's error is visible.
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { publish } from "@/lib/events";
import { helpArticles, triageResults, type AiLane, type TriageCategory, type TriageUrgency } from "@/lib/db/schema";
// The queue and registry modules only: lib/jobs itself imports the job kinds, which import this file.
import { enqueueJob } from "@/lib/jobs/queue";
import { type JobContext, RetryLater } from "@/lib/jobs/registry";
import { latestInboundMessage } from "@/lib/messages";
import { getTicket, getValidTriage, type CurrentTriage } from "@/lib/tickets";
import { triageModelName } from "./config";
import { AiRateLimitedError } from "./errors";
import { AI_JOB_KINDS, finishAiCall, reserveAiCall } from "./limiter";
import { redactContactDetails } from "./redact";
import { runTriageModel, type TriageInput } from "./provider";
import { triageOutputSchema } from "./schema";
import { getTriageState, setTriageState, type TriageState } from "./state";

export { aiBudget, type AiBudget } from "./limiter";
export { getTriageState, PENDING_STATES, type TriageState, type TriageStateName } from "./state";

export const TRIAGE_MANUAL = "triage.manual";
/** Job priorities: a manual click goes ahead of queued automatic triage (ticket 18: `auto`). */
export const TRIAGE_PRIORITY: Record<AiLane, number> = { manual: 100, auto: 0 };
/** Provider errors (not rate limits) get this many tries in all before the triage is Failed. */
export const TRIAGE_MAX_ATTEMPTS = 3;
export const TRIAGE_BACKOFF_SECONDS = [10, 30] as const;
/** Wait after a provider 429 that carried no Retry-After. */
export const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 60;

export type TriageJobPayload = { ticketId: number; lane: AiLane; requestedBy: number | null; force?: boolean };

type TriageRow = typeof triageResults.$inferSelect;

/** What the API and UI see. A failed attempt never carries a draft. */
export type TriageView =
  | {
      status: "ok";
      id: number;
      category: TriageCategory;
      urgency: TriageUrgency;
      draft: string;
      article: { id: string; title: string } | null;
      model: string;
      createdAt: Date;
    }
  | { status: "error"; id: number; error: string; rawOutput: string | null; model: string; createdAt: Date };

export type TriageOutcome =
  | { kind: "not_found" }
  /** A valid, up-to-date result exists; nothing was enqueued. */
  | { kind: "cached"; triage: TriageView; state: TriageState }
  /** A triage job is queued (or already was): follow `state`. */
  | { kind: "queued"; state: TriageState };

function validView(t: CurrentTriage): TriageView {
  return {
    status: "ok",
    id: t.id,
    category: t.category,
    urgency: t.urgency,
    draft: t.draft,
    article: t.article ? { id: t.article.id, title: t.article.title } : null,
    model: t.model,
    createdAt: t.createdAt,
  };
}

async function toView(row: TriageRow): Promise<TriageView> {
  if (row.error !== null) {
    return { status: "error", id: row.id, error: row.error, rawOutput: row.rawOutput, model: row.model, createdAt: row.createdAt };
  }
  return validView((await getValidTriage(row.ticketId, row.id))!);
}

/**
 * The latest triage ATTEMPT (valid or failed), or null if never triaged. Only the triage panel
 * uses this, to show a failed attempt's error; everything else uses the current (latest valid)
 * triage from lib/tickets.
 */
export async function getLatestAttempt(ticketId: number): Promise<TriageView | null> {
  const [row] = await getDb()
    .select()
    .from(triageResults)
    .where(eq(triageResults.ticketId, ticketId))
    .orderBy(desc(triageResults.createdAt), desc(triageResults.id))
    .limit(1);
  return row ? toView(row) : null;
}

/** Parses and checks the provider's raw text: a valid triage output, or an error message. */
async function parseModelOutput(rawText: string) {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false as const, error: "The AI returned output that is not valid JSON." };
  }
  const parsed = triageOutputSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false as const, error: `The AI result did not match the expected shape (${detail}).` };
  }
  const out = parsed.data;
  if (out.article_id !== null) {
    const [a] = await getDb()
      .select({ id: helpArticles.id })
      .from(helpArticles)
      .where(eq(helpArticles.id, out.article_id))
      .limit(1);
    if (!a) return { ok: false as const, error: `The AI cited a help article that does not exist ("${out.article_id}").` };
  }
  return { ok: true as const, value: out };
}

/** A ticket's triage job that has not finished yet, if any. */
async function pendingTriageJob(ticketId: number): Promise<number | null> {
  const [row] = await getDb().execute<{ id: number }>(sql`
    select id from jobs
    where kind in ${AI_JOB_KINDS} and status in ('queued', 'running') and (payload->>'ticketId')::int = ${ticketId}
    limit 1`);
  return row?.id ?? null;
}

/**
 * Asks for a ticket's triage. The current valid result is returned as is (no provider call)
 * unless it is out of date or `force` is set (admin regenerate; the route checks the role).
 * Otherwise a high-priority `triage.manual` job is enqueued, unless one is already pending.
 */
export async function requestTriage(
  ticketId: number,
  opts: { requestedBy: number; force?: boolean },
): Promise<TriageOutcome> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return { kind: "not_found" };

  const current = await getTriageState(ticketId);
  if (!opts.force && ticket.currentTriage && current.state !== "superseded") {
    return { kind: "cached", triage: validView(ticket.currentTriage), state: current };
  }

  if ((await pendingTriageJob(ticketId)) === null) {
    const payload: TriageJobPayload = { ticketId, lane: "manual", requestedBy: opts.requestedBy, force: opts.force };
    await getDb().transaction(async (tx) => {
      await enqueueJob(TRIAGE_MANUAL, payload, { priority: TRIAGE_PRIORITY.manual, maxAttempts: TRIAGE_MAX_ATTEMPTS }, tx);
      await setTriageState(ticketId, "queued", null, tx);
    });
    await publish({ type: "triage.updated", ticketId });
    await publish({ type: "ai_budget.updated" });
  }
  return { kind: "queued", state: await getTriageState(ticketId) };
}

async function changeState(ticketId: number, state: Parameters<typeof setTriageState>[1], retryAt: Date | null = null) {
  await setTriageState(ticketId, state, retryAt);
  await publish({ type: "triage.updated", ticketId });
}

/** Waits on a limit: shows the retry time and hands the job back to the queue until then. */
async function waitFor(
  ticketId: number,
  state: "waiting_rate_limit" | "daily_cap_reached",
  retryAt: Date,
  why: string,
): Promise<never> {
  await changeState(ticketId, state, retryAt);
  await publish({ type: "ai_budget.updated" });
  throw new RetryLater(retryAt, why);
}

/**
 * The triage job (`triage.manual`, and `triage.auto` from ticket 18): one provider call through
 * the budget gate. A refusal by our limiter or a provider 429 waits and retries, and is never
 * stored as a failure. Invalid output is stored as a failed attempt at once; a provider error is
 * retried by the queue and stored as failed when the last try fails (failTriageJob).
 */
export async function runTriageJob(payload: TriageJobPayload, job: JobContext): Promise<void> {
  const { ticketId } = payload;
  const ticket = await getTicket(ticketId);
  if (!ticket) return;
  // Another request already produced an up-to-date result.
  if (!payload.force && ticket.currentTriage && (await getTriageState(ticketId)).state === "done") return;

  await changeState(ticketId, "running");
  const slot = await reserveAiCall({ lane: payload.lane, ticketId });
  if (!slot.ok) {
    return slot.reason === "daily_cap"
      ? waitFor(ticketId, "daily_cap_reached", slot.retryAt, "Daily AI limit reached")
      : waitFor(ticketId, "waiting_rate_limit", slot.retryAt, "Waiting on the per-minute AI limit");
  }
  await publish({ type: "ai_budget.updated" });

  const db = getDb();
  const articles = await db
    .select({ id: helpArticles.id, title: helpArticles.title, body: helpArticles.body })
    .from(helpArticles)
    .orderBy(helpArticles.id);
  // The customer's latest message is what the draft answers. Customer emails and phone numbers
  // never reach the provider; the stored ticket is unchanged.
  const latest = await latestInboundMessage(ticketId);
  const input: TriageInput = {
    subject: redactContactDetails(ticket.subject),
    body: redactContactDetails(latest?.bodyText ?? ticket.body),
    articles,
  };

  let output;
  try {
    output = await runTriageModel(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof AiRateLimitedError) {
      await finishAiCall(slot.callId, "rate_limited", message);
      const wait = err.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_WAIT_SECONDS;
      return waitFor(ticketId, "waiting_rate_limit", new Date(Date.now() + wait * 1000), "The AI provider rate-limited the call");
    }
    await finishAiCall(slot.callId, "error", message);
    if (job.attempts < job.maxAttempts) await changeState(ticketId, "queued");
    throw err;
  }

  const base = { ticketId, requestedBy: payload.requestedBy };
  const result = await parseModelOutput(output.rawText);
  const record: typeof triageResults.$inferInsert = result.ok
    ? {
        ...base,
        model: output.model,
        category: result.value.category,
        urgency: result.value.urgency,
        draft: result.value.draft,
        articleId: result.value.article_id,
      }
    : { ...base, model: output.model, error: result.error, rawOutput: output.rawText };
  await finishAiCall(slot.callId, result.ok ? "ok" : "invalid", result.ok ? undefined : result.error);
  await db.insert(triageResults).values(record);
  await changeState(ticketId, result.ok ? "done" : "failed");
  await publish({ type: "ai_budget.updated" });
}

/** The provider kept failing: store the error as a failed attempt the agent can retry. */
export async function failTriageJob(payload: TriageJobPayload, error: string): Promise<void> {
  if (!(await getTicket(payload.ticketId))) return;
  await getDb()
    .insert(triageResults)
    .values({
      ticketId: payload.ticketId,
      requestedBy: payload.requestedBy,
      model: triageModelName(),
      error: `The AI provider request failed: ${error}`.slice(0, 1000),
    });
  await changeState(payload.ticketId, "failed");
  await publish({ type: "ai_budget.updated" });
}
