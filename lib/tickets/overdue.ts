// The overdue rule, in one place: the list badge, the overdue filter, the header count and the
// overdue sweep (which releases overdue tickets) all use overdueCondition().
import { and, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets } from "@/lib/db/schema";

export const DEFAULT_OVERDUE_HOURS = 24;

/** How long a customer message may wait for a sent reply, from OVERDUE_HOURS (a positive number). */
export function overdueHours(): number {
  const raw = process.env.OVERDUE_HOURS?.trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : DEFAULT_OVERDUE_HOURS;
}

/**
 * A ticket is overdue when it isn't closed, the customer's latest message has no later sent
 * reply, and that message is at least overdueHours() old (by the database clock).
 * `last_outbound_at` only advances when a reply reaches `sent`, so a queued, failed or bounced
 * reply never clears the marker; anything that changes how replies are sent must keep that true.
 */
export function overdueCondition(): SQL {
  return and(
    ne(tickets.status, "closed"),
    sql`${tickets.lastInboundAt} <= now() - ${overdueHours()} * interval '1 hour'`,
    sql`(${tickets.lastOutboundAt} is null or ${tickets.lastOutboundAt} <= ${tickets.lastInboundAt})`,
  )!;
}

/** When the customer's unanswered message arrived, for overdue tickets; null otherwise. */
export function overdueWaitingSince() {
  return sql<Date | null>`case when ${overdueCondition()} then ${tickets.lastInboundAt} end`.mapWith(tickets.lastInboundAt);
}

/** Number of overdue tickets (the header count). */
export async function overdueCount(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(overdueCondition());
  return row.n;
}
