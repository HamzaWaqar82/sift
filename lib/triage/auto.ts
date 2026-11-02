// Automatic triage on arrival. A leaf module: lib/tickets enqueues from here inside the ticket's
// own transaction, and lib/triage (which imports lib/tickets) re-exports these.
import type { AiLane } from "@/lib/db/schema";
import { enqueueJob, type JobExecutor } from "@/lib/jobs/queue";
import { setTriageState } from "./state";

export const TRIAGE_MANUAL = "triage.manual";
export const TRIAGE_AUTO = "triage.auto";
/** Job priorities: a manual click goes ahead of queued automatic triage. */
export const TRIAGE_PRIORITY: Record<AiLane, number> = { manual: 100, auto: 0 };
/** Provider errors (not rate limits) get this many tries in all before the triage is Failed. */
export const TRIAGE_MAX_ATTEMPTS = 3;

/**
 * Queues a new ticket's first triage. Only ticket creation calls this: a customer reply never
 * starts an AI call (it marks the triage out of date, and an agent re-triages by hand).
 */
export async function enqueueAutoTriage(ticketId: number, tx: JobExecutor) {
  await enqueueJob(
    TRIAGE_AUTO,
    { ticketId, lane: "auto", requestedBy: null },
    { priority: TRIAGE_PRIORITY.auto, maxAttempts: TRIAGE_MAX_ATTEMPTS },
    tx,
  );
  await setTriageState(ticketId, "queued", null, tx);
}
