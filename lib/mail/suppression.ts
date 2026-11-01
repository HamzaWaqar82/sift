// Addresses we must not mail. Ticket 14 adds bounced addresses; sending checks here first.
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { suppressedEmails } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;
type Executor = Pick<Db, "select" | "insert">;

/** The suppression entry for `email` (case-insensitive), or null. */
export async function suppressionOf(email: string, db: Executor = getDb()): Promise<{ reason: string } | null> {
  const [row] = await db
    .select({ reason: suppressedEmails.reason })
    .from(suppressedEmails)
    .where(eq(suppressedEmails.email, email.trim().toLowerCase()));
  return row ?? null;
}

/** Adds `email` to the list; a repeat keeps the first reason. */
export async function suppressEmail(email: string, reason: string, db: Executor = getDb()): Promise<void> {
  await db
    .insert(suppressedEmails)
    .values({ email: email.trim().toLowerCase(), reason })
    .onConflictDoNothing({ target: suppressedEmails.email });
}
