// THE routing rule: an unowned ticket goes to the active, available user with the fewest open
// (not closed) tickets, ties to whoever was assigned least recently (never-assigned first).
// Used on creation; ticket 14 calls it when a pooled ticket gets a customer reply, ticket 21
// for the ack-timeout hand-on.
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets, users } from "@/lib/db/schema";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

// Serialises routing decisions, so two tickets created at once see each other's load.
const ROUTING_LOCK = 2020_0001;

/**
 * Assigns the ticket (if it is still unowned) inside the caller's transaction and returns the
 * new owner's id, or null when nobody is available and the ticket stays in the pool.
 * `exclude` skips a user (the ack-timeout's previous owner). The caller publishes the event.
 */
export async function autoAssign(tx: Tx, ticketId: number, opts: { exclude?: number } = {}): Promise<number | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ROUTING_LOCK})`);
  const openCount = sql<number>`(select count(*) from ${tickets} t
    where t.assignee_id = ${users.id} and t.status <> 'closed')`;
  const [pick] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.availability, "available"),
        isNull(users.deactivatedAt),
        opts.exclude === undefined ? undefined : sql`${users.id} <> ${opts.exclude}`,
      ),
    )
    .orderBy(openCount, sql`${users.lastAssignedAt} asc nulls first`, users.id)
    .limit(1);
  if (!pick) return null;

  const [assigned] = await tx
    .update(tickets)
    .set({ assigneeId: pick.id, assignedBy: "auto", assignedAt: sql`now()`, firstOpenedAt: null, updatedAt: sql`now()` })
    .where(and(eq(tickets.id, ticketId), isNull(tickets.assigneeId)))
    .returning({ id: tickets.id });
  if (!assigned) return null;
  await tx.update(users).set({ lastAssignedAt: sql`now()` }).where(eq(users.id, pick.id));
  return pick.id;
}
