// The job queue on Postgres. One process (the worker) calls runDueJobs() in a loop; tests call it
// directly after enqueueing work or ageing timestamps. Claims use FOR UPDATE SKIP LOCKED so a
// second runner never takes the same job.
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { backoffFor, type JobContext, jobHandler } from "./registry";

type Db = ReturnType<typeof getDb>;
/** The shared client or an open transaction, so a job can be enqueued atomically with its cause. */
export type JobExecutor = Pick<Db, "insert">;

export type EnqueueOptions = {
  /** Higher runs first among due jobs. Default 0. */
  priority?: number;
  /** Not before this time. Default now. */
  runAt?: Date;
  /** Tries before the job ends as `failed`. Default 5. */
  maxAttempts?: number;
};

export async function enqueueJob(
  kind: string,
  payload: unknown = {},
  options: EnqueueOptions = {},
  executor: JobExecutor = getDb(),
): Promise<number> {
  const [row] = await executor
    .insert(jobs)
    .values({
      kind,
      payload: payload ?? {},
      priority: options.priority ?? 0,
      runAt: options.runAt,
      maxAttempts: options.maxAttempts ?? 5,
    })
    .returning({ id: jobs.id });
  return row.id;
}

/** A running job whose lock is older than this is assumed abandoned (worker crashed or restarted). */
export const STALE_LOCK_MS = 10 * 60 * 1000;
const MAX_ERROR_LENGTH = 2000;
const STALE_LOCK_ERROR = "Lock expired: the worker stopped while running this job";

export type RunSummary = { succeeded: number; retried: number; failed: number; recovered: number };

type ClaimedRow = { id: number; kind: string; payload: unknown; attempts: number; max_attempts: number };

/**
 * Processes every job that is due when the call starts, each at most once, in priority then
 * run_at order. Failures are retried with the handler's backoff; exhausted jobs end as `failed`
 * with the last error. Stale locks are recovered first.
 */
export async function runDueJobs(options: { staleLockMs?: number } = {}): Promise<RunSummary> {
  const db = getDb();
  const summary: RunSummary = { succeeded: 0, retried: 0, failed: 0, recovered: 0 };

  summary.recovered = await recoverStaleLocks(options.staleLockMs ?? STALE_LOCK_MS, summary);

  const [{ now: cutoff }] = await db.execute<{ now: string }>(sql`select now()::text as now`);
  const seen: number[] = [];
  for (;;) {
    const notSeen = seen.length ? sql`and id not in ${seen}` : sql``;
    const [job] = await db.execute<ClaimedRow>(sql`
      update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
      where id = (
        select id from jobs
        where status = 'queued' and run_at <= ${cutoff}::timestamptz ${notSeen}
        order by priority desc, run_at, id
        for update skip locked
        limit 1
      )
      returning id, kind, payload, attempts, max_attempts`);
    if (!job) break;
    seen.push(job.id);
    summary[await runOne(job)] += 1;
  }
  return summary;
}

async function runOne(row: ClaimedRow): Promise<"succeeded" | "retried" | "failed"> {
  const db = getDb();
  const ctx: JobContext = { id: row.id, kind: row.kind, attempts: row.attempts, maxAttempts: row.max_attempts };
  const handler = jobHandler(row.kind);
  try {
    if (!handler) throw new UnknownJobKindError(row.kind);
    await handler.run(row.payload, ctx);
  } catch (error) {
    const message = errorMessage(error);
    if (handler && row.attempts < row.max_attempts) {
      const delay = backoffFor(handler, row.attempts);
      await db.execute(sql`
        update jobs set status = 'queued', locked_at = null, last_error = ${message},
          run_at = now() + make_interval(secs => ${delay})
        where id = ${row.id}`);
      return "retried";
    }
    await markFailed(row.id, message);
    await notifyFailed(row.kind, row.payload, message, ctx);
    return "failed";
  }
  await db.execute(sql`
    update jobs set status = 'done', locked_at = null, last_error = null, finished_at = now()
    where id = ${row.id}`);
  return "succeeded";
}

/** Requeues abandoned claims (or fails them if they had used their last attempt). */
async function recoverStaleLocks(staleLockMs: number, summary: RunSummary): Promise<number> {
  const rows = await getDb().execute<ClaimedRow & { status: string }>(sql`
    update jobs set
      status = (case when attempts >= max_attempts then 'failed' else 'queued' end)::job_status,
      finished_at = case when attempts >= max_attempts then now() end,
      locked_at = null, last_error = ${STALE_LOCK_ERROR}, run_at = now()
    where status = 'running' and locked_at < now() - make_interval(secs => ${staleLockMs / 1000})
    returning id, kind, payload, attempts, max_attempts, status`);
  for (const row of rows) {
    if (row.status !== "failed") continue;
    summary.failed += 1;
    await notifyFailed(row.kind, row.payload, STALE_LOCK_ERROR, {
      id: row.id,
      kind: row.kind,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    });
  }
  return rows.length;
}

async function markFailed(id: number, message: string) {
  await getDb().execute(sql`
    update jobs set status = 'failed', locked_at = null, last_error = ${message}, finished_at = now()
    where id = ${id}`);
}

async function notifyFailed(kind: string, payload: unknown, message: string, ctx: JobContext) {
  try {
    await jobHandler(kind)?.onFailed?.(payload, message, ctx);
  } catch (error) {
    console.error(`[jobs] onFailed for ${kind} #${ctx.id} threw`, error);
  }
}

export class UnknownJobKindError extends Error {
  constructor(kind: string) {
    super(`No handler registered for job kind "${kind}"`);
  }
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}
