// The ownership sweeps (job kinds in lib/jobs/kinds/ownership-sweeps.ts): no customer stays stuck
// behind one person. An auto-assignment nobody opens moves on; an overdue ticket returns to the pool.
import { and, eq, isNotNull, isNull, ne, not, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { tickets } from "@/lib/db/schema";
import { publish } from "@/lib/events";
import { autoAssign } from "./auto-assign";
import { releaseTicket } from "./index";
import { overdueCondition } from "./overdue";

export const DEFAULT_ACK_TIMEOUT_MINUTES = 240;

/** How long an auto-assigned ticket may stay unopened, from ACK_TIMEOUT_MINUTES (a positive number). */
export function ackTimeoutMinutes(): number {
  const raw = process.env.ACK_TIMEOUT_MINUTES?.trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : DEFAULT_ACK_TIMEOUT_MINUTES;
}

/** Records that the owner opened the ticket (only the first time since it was assigned to them). */
export async function markOpened(ticketId: number, userId: number) {
  await getDb()
    .update(tickets)
    .set({ firstOpenedAt: sql`now()` })
    .where(and(eq(tickets.id, ticketId), eq(tickets.assigneeId, userId), isNull(tickets.firstOpenedAt)));
}

/** Hands each unopened, timed-out auto-assignment to the next candidate (never the same person), or the pool. */
export async function ackTimeoutSweep() {
  const db = getDb();
  const unopened = and(eq(tickets.assignedBy, "auto"), isNull(tickets.firstOpenedAt), ne(tickets.status, "closed"));
  const due = await db
    .select({ id: tickets.id, ownerId: tickets.assigneeId })
    .from(tickets)
    .where(
      and(unopened, isNotNull(tickets.assigneeId), sql`${tickets.assignedAt} <= now() - ${ackTimeoutMinutes()} * interval '1 minute'`),
    );

  for (const { id, ownerId } of due) {
    const moved = await db.transaction(async (tx) => {
      // Re-checked under the update: the owner may have opened it since the select.
      const [released] = await tx
        .update(tickets)
        .set({ assigneeId: null, assignedBy: "system", releasedFromUserId: ownerId, releaseReason: "not opened", updatedAt: sql`now()` })
        .where(and(eq(tickets.id, id), eq(tickets.assigneeId, ownerId!), unopened))
        .returning({ id: tickets.id });
      return released ? { next: await autoAssign(tx, id, { exclude: ownerId! }) } : null;
    });
    if (!moved) continue;
    await recordAudit({ actorId: null, action: "ticket_released", ticketId: id, targetUserId: ownerId, metadata: { reason: "not opened" } });
    await publish({ type: "ticket.released", ticketId: id });
    if (moved.next !== null) await publish({ type: "ticket.assigned", ticketId: id, assigneeId: moved.next, actorId: null });
  }
}

/**
 * Marks newly overdue tickets (`overdue_since`) and releases any that have an owner. A ticket that
 * stops being overdue (a sent reply, closing) is unmarked, so a later wait releases it again.
 */
export async function overdueSweep() {
  const db = getDb();
  await db
    .update(tickets)
    .set({ overdueSince: null })
    .where(and(isNotNull(tickets.overdueSince), not(overdueCondition())));
  const marked = await db
    .update(tickets)
    .set({ overdueSince: sql`now()` })
    .where(and(isNull(tickets.overdueSince), overdueCondition()))
    .returning({ id: tickets.id, ownerId: tickets.assigneeId });

  for (const { id, ownerId } of marked) {
    await publish({ type: "overdue.marked", ticketId: id });
    if (ownerId !== null) await releaseTicket(id, { actorId: null, expectedOwnerId: ownerId, reason: "overdue", system: true });
  }
}

/** Returns a deactivated user's open tickets to the pool. */
export async function releaseTicketsOf(userId: number, actorId: number) {
  const owned = await getDb()
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.assigneeId, userId), ne(tickets.status, "closed")));
  for (const { id } of owned) {
    await releaseTicket(id, { actorId, expectedOwnerId: userId, reason: "deactivated", system: true });
  }
}
