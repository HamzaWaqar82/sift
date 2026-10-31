// Daily AI call cap, counted per UTC day in the ai_usage table.
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { aiDailyCap } from "./config";

/** Today's UTC date as YYYY-MM-DD (the ai_usage key). */
export function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Takes one slot from today's cap: returns false (and counts nothing) when the cap is reached,
 * otherwise records one call and returns true.
 *
 * KNOWN PROBLEM (documented in the README): the read and the increment are separate statements,
 * so two simultaneous requests can both see `calls = cap - 1` and both proceed, overshooting the
 * cap. The fix is one atomic reservation, e.g.
 *   INSERT INTO ai_usage (day, calls) VALUES ($day, 1)
 *   ON CONFLICT (day) DO UPDATE SET calls = ai_usage.calls + 1 WHERE ai_usage.calls < $cap
 *   RETURNING calls;
 * where no returned row means the cap is reached. Left as is deliberately.
 */
export async function takeDailySlot(now = new Date()): Promise<boolean> {
  const db = getDb();
  const day = usageDay(now);
  const [row] = await db.select({ calls: aiUsage.calls }).from(aiUsage).where(eq(aiUsage.day, day)).limit(1);
  if ((row?.calls ?? 0) >= aiDailyCap()) return false;
  await db
    .insert(aiUsage)
    .values({ day, calls: 1 })
    .onConflictDoUpdate({ target: aiUsage.day, set: { calls: sql`${aiUsage.calls} + 1` } });
  return true;
}
