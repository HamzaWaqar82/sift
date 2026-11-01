// Fixed-window counters in the rate_limits table, so an app restart never resets an attacker's
// budget. A key names what is counted, e.g. "sign-in:ip:1.2.3.4" or "sign-in:email:a@b.c".
// Times come from the database clock, so every app instance agrees on the window.
import { and, gt, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";

export type Limit = { max: number; windowMs: number };

/** Sign-in: 5 failures per 15 minutes, counted per IP and per email. */
export const SIGN_IN_LIMIT: Limit = { max: 5, windowMs: 15 * 60 * 1000 };

/**
 * Client address. In production only Caddy can reach the app, and Caddy overwrites
 * X-Forwarded-For with the real client IP, so the first entry is trustworthy there.
 */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

const windowEnd = (limit: Limit) => sql`${rateLimits.windowStart} + make_interval(secs => ${limit.windowMs / 1000})`;

/** Seconds until every key is under its limit again, or 0 if none is blocked. */
export async function blockedFor(keys: string[], limit: Limit): Promise<number> {
  const [row] = await getDb()
    .select({ wait: sql<number>`ceil(extract(epoch from max(${windowEnd(limit)}) - now()))::int` })
    .from(rateLimits)
    .where(and(inArray(rateLimits.key, keys), gte(rateLimits.count, limit.max), gt(windowEnd(limit), sql`now()`)));
  return Math.max(row?.wait ?? 0, 0);
}

/** Counts one hit against each key, starting a fresh window where the old one has expired. */
export async function recordHit(keys: string[], limit: Limit): Promise<void> {
  const expired = sql`${windowEnd(limit)} <= now()`;
  await getDb()
    .insert(rateLimits)
    .values(keys.map((key) => ({ key, windowStart: sql`now()`, count: 1 })))
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    });
}

export async function clearHits(keys: string[]): Promise<void> {
  await getDb().delete(rateLimits).where(inArray(rateLimits.key, keys));
}
