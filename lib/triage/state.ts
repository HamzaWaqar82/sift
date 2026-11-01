// Each ticket's visible triage state. The job writes the stored state as it goes; "Out of date"
// is worked out on read, so a customer message never has to touch triage.
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ticketTriage, tickets, triageResults, type StoredTriageState } from "@/lib/db/schema";

export type TriageStateName = StoredTriageState | "none" | "superseded";
/** `retryAt` only for waiting_rate_limit and daily_cap_reached. */
export type TriageState = { state: TriageStateName; retryAt: Date | null };

/** States that end with a job still to run. */
export const PENDING_STATES: readonly TriageStateName[] = ["queued", "running", "waiting_rate_limit", "daily_cap_reached"];

type Executor = Pick<ReturnType<typeof getDb>, "insert">;

export async function setTriageState(
  ticketId: number,
  state: StoredTriageState,
  retryAt: Date | null = null,
  db: Executor = getDb(),
) {
  await db
    .insert(ticketTriage)
    .values({ ticketId, state, retryAt })
    .onConflictDoUpdate({ target: ticketTriage.ticketId, set: { state, retryAt, updatedAt: sql`now()` } });
}

/**
 * The state shown on the ticket. Tickets triaged before states were stored fall back to their
 * latest attempt. A done triage older than the customer's latest message is `superseded`.
 */
export async function getTriageState(ticketId: number): Promise<TriageState> {
  const db = getDb();
  const [[stored], [latest], [ticket]] = await Promise.all([
    db.select().from(ticketTriage).where(eq(ticketTriage.ticketId, ticketId)),
    db
      .select({ error: triageResults.error, createdAt: triageResults.createdAt })
      .from(triageResults)
      .where(eq(triageResults.ticketId, ticketId))
      .orderBy(desc(triageResults.createdAt), desc(triageResults.id))
      .limit(1),
    db.select({ lastInboundAt: tickets.lastInboundAt }).from(tickets).where(eq(tickets.id, ticketId)),
  ]);
  const state: StoredTriageState | "none" = stored?.state ?? (latest ? (latest.error === null ? "done" : "failed") : "none");
  if (state === "done" && latest && ticket?.lastInboundAt && ticket.lastInboundAt > latest.createdAt) {
    return { state: "superseded", retryAt: null };
  }
  return { state, retryAt: stored?.retryAt ?? null };
}
