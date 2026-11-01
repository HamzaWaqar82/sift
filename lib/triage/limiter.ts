// The one AI budget gate. Every provider call first reserves a slot here, which checks the
// per-UTC-day cap (ai_usage) and the per-minute window (ai_calls in the last 60 seconds).
// Reservations take a transaction-scoped advisory lock, so the check and the increment are one
// atomic step across every process: simultaneous requests can never overshoot either limit.
import { and, asc, count, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { aiCalls, aiUsage, jobs, type AiCallOutcome, type AiLane } from "@/lib/db/schema";
import { aiDailyCap, aiManualReservePct, aiRpmLimit, triageModelName } from "./config";

export const WINDOW_MS = 60_000;
/** Job kinds that spend the AI budget; the chip counts them as "queued". Ticket 18 adds triage.auto. */
export const AI_JOB_KINDS = ["triage.manual", "triage.auto"];
const LOCK_KEY = "sift.ai_limiter";

/** Today's UTC date as YYYY-MM-DD (the ai_usage key). */
export function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function nextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * Calls a lane may make per day: manual triage the whole cap, automatic triage only what the
 * manual reserve (AI_MANUAL_RESERVE_PCT) leaves, so agents can still triage by hand on a busy day.
 */
export function dailyLimitFor(lane: AiLane): number {
  const cap = aiDailyCap();
  return lane === "manual" ? cap : Math.floor((cap * (100 - aiManualReservePct())) / 100);
}

export type Reservation =
  | { ok: true; callId: number }
  /** Nothing was counted. `retryAt`: when a slot frees up (window slide or next UTC day). */
  | { ok: false; reason: "rate_limit" | "daily_cap"; retryAt: Date };

/** Reserves one provider call, or says when to try again. */
export async function reserveAiCall(opts: { lane: AiLane; ticketId?: number | null; now?: Date }): Promise<Reservation> {
  const now = opts.now ?? new Date();
  const day = usageDay(now);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);

    const [usage] = await tx.select({ calls: aiUsage.calls }).from(aiUsage).where(eq(aiUsage.day, day));
    if ((usage?.calls ?? 0) >= dailyLimitFor(opts.lane)) {
      return { ok: false, reason: "daily_cap", retryAt: nextUtcDay(now) } as const;
    }

    const rpm = aiRpmLimit();
    const recent = await tx
      .select({ startedAt: aiCalls.startedAt })
      .from(aiCalls)
      .where(and(gt(aiCalls.startedAt, new Date(now.getTime() - WINDOW_MS)), lte(aiCalls.startedAt, now)))
      .orderBy(desc(aiCalls.startedAt))
      .limit(Math.max(rpm, 1));
    if (recent.length >= rpm) {
      // The window frees a slot when its rpm-th newest call turns 60 seconds old.
      const freesAt = recent[rpm - 1]?.startedAt ?? now;
      return { ok: false, reason: "rate_limit", retryAt: new Date(freesAt.getTime() + WINDOW_MS) } as const;
    }

    await tx
      .insert(aiUsage)
      .values({ day, calls: 1 })
      .onConflictDoUpdate({ target: aiUsage.day, set: { calls: sql`${aiUsage.calls} + 1` } });
    const [call] = await tx
      .insert(aiCalls)
      .values({ lane: opts.lane, ticketId: opts.ticketId ?? null, model: triageModelName(), startedAt: now })
      .returning({ id: aiCalls.id });
    return { ok: true, callId: call.id } as const;
  });
}

/** Records how a reserved call ended (for the admin AI panel). */
export async function finishAiCall(callId: number, outcome: Exclude<AiCallOutcome, "pending">, detail?: string) {
  await getDb()
    .update(aiCalls)
    .set({ outcome, detail: detail?.slice(0, 500) ?? null, finishedAt: new Date() })
    .where(eq(aiCalls.id, callId));
}

export type AiBudget = {
  used: number;
  cap: number;
  /** AI jobs waiting to run (including ones waiting on a limit). */
  queued: number;
  /** At or above 80% of the cap. */
  nearCap: boolean;
  /** Set while a limit blocks every call: the minute window is full or the cap is used. */
  pausedUntil: Date | null;
};

/** Today's AI use for the header chip. */
export async function aiBudget(now = new Date()): Promise<AiBudget> {
  const db = getDb();
  const cap = aiDailyCap();
  const rpm = aiRpmLimit();
  const [[usage], recent, [queue]] = await Promise.all([
    db.select({ calls: aiUsage.calls }).from(aiUsage).where(eq(aiUsage.day, usageDay(now))),
    db
      .select({ startedAt: aiCalls.startedAt })
      .from(aiCalls)
      .where(gt(aiCalls.startedAt, new Date(now.getTime() - WINDOW_MS)))
      .orderBy(desc(aiCalls.startedAt))
      .limit(Math.max(rpm, 1)),
    db
      .select({ n: count() })
      .from(jobs)
      .where(and(inArray(jobs.kind, AI_JOB_KINDS), eq(jobs.status, "queued"))),
  ]);
  const used = usage?.calls ?? 0;
  let pausedUntil: Date | null = null;
  if (used >= cap) pausedUntil = nextUtcDay(now);
  else if (recent.length >= rpm) pausedUntil = new Date((recent[rpm - 1]?.startedAt ?? now).getTime() + WINDOW_MS);
  return { used, cap, queued: queue.n, nearCap: cap > 0 && used >= cap * 0.8, pausedUntil };
}

/** The admin AI panel: recent calls, today's 429s, the AI queue and failed jobs. */
export async function aiPanel(now = new Date()) {
  const db = getDb();
  const dayStart = new Date(`${usageDay(now)}T00:00:00Z`);
  const [calls, [limited], queue, failedJobs] = await Promise.all([
    db.select().from(aiCalls).orderBy(desc(aiCalls.startedAt), desc(aiCalls.id)).limit(50),
    db
      .select({ n: count() })
      .from(aiCalls)
      .where(and(eq(aiCalls.outcome, "rate_limited"), gte(aiCalls.startedAt, dayStart))),
    db
      .select({ status: jobs.status, n: count() })
      .from(jobs)
      .where(and(inArray(jobs.kind, AI_JOB_KINDS), inArray(jobs.status, ["queued", "running"])))
      .groupBy(jobs.status),
    db
      .select({
        id: jobs.id,
        kind: jobs.kind,
        payload: jobs.payload,
        attempts: jobs.attempts,
        lastError: jobs.lastError,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .where(eq(jobs.status, "failed"))
      .orderBy(desc(jobs.finishedAt), asc(jobs.id))
      .limit(20),
  ]);
  const depth = (s: string) => queue.find((q) => q.status === s)?.n ?? 0;
  return {
    budget: await aiBudget(now),
    rpm: aiRpmLimit(),
    rateLimitedToday: limited.n,
    queue: { queued: depth("queued"), running: depth("running") },
    calls,
    failedJobs,
  };
}
