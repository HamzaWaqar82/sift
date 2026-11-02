// Job handlers, registered by kind. Each kind lives in its own module under lib/jobs/kinds and
// calls registerJobHandler at import; lib/jobs/kinds/index.ts imports them all.

export type JobContext = { id: number; kind: string; attempts: number; maxAttempts: number };

export type JobHandler<P = unknown> = {
  /** Does the work. Throwing schedules a retry (or fails the job once attempts run out). */
  run(payload: P, job: JobContext): Promise<void>;
  /** Seconds to wait before retry n (index n-1); the last entry repeats. */
  backoffSeconds?: readonly number[];
  /** Called once when the job ends as `failed`, e.g. to mark an outbound message failed. */
  onFailed?(payload: P, error: string, job: JobContext): Promise<void>;
};

/** Spec backoff for retried work: 10s, 1m, 5m, 30m, 2h. */
export const DEFAULT_BACKOFF_SECONDS = [10, 60, 5 * 60, 30 * 60, 2 * 60 * 60] as const;

/**
 * Thrown by a handler to run the job again at `runAt` without using up an attempt or counting as
 * a failure: e.g. an AI call refused by a rate limit, which is waiting, not broken.
 */
export class RetryLater extends Error {
  readonly runAt: Date;
  constructor(runAt: Date, reason: string) {
    super(reason);
    this.name = "RetryLater";
    this.runAt = runAt;
  }
}

const handlers = new Map<string, JobHandler>();

export function registerJobHandler<P>(kind: string, handler: JobHandler<P>) {
  handlers.set(kind, handler as JobHandler);
}

export function jobHandler(kind: string): JobHandler | undefined {
  return handlers.get(kind);
}

/** Seconds before the next try after `attempts` failed tries. */
export function backoffFor(handler: JobHandler | undefined, attempts: number): number {
  const steps = handler?.backoffSeconds ?? DEFAULT_BACKOFF_SECONDS;
  if (steps.length === 0) return 0;
  return steps[Math.min(attempts, steps.length) - 1] ?? steps[0];
}
