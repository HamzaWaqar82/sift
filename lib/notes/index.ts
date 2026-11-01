// Internal (staff-only) notes. Kept apart from `lib/messages` on purpose: nothing that builds a
// triage prompt or outbound mail reads this module, and adding a note writes only `internal_notes`.
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { publish } from "@/lib/events";
import { internalNotes, tickets, users, type UserRef } from "@/lib/db/schema";
import { cleanText } from "@/lib/text";

export const noteInputSchema = z
  .object({
    body: z
      .string()
      .transform(cleanText)
      .pipe(
        z
          .string()
          .max(10_000, "Note must be 10,000 characters or fewer")
          .refine((s) => s.trim().length > 0, "Note cannot be empty"),
      ),
  })
  .strict();

export type InternalNote = {
  id: number;
  ticketId: number;
  author: UserRef;
  body: string;
  createdAt: Date;
};

/** Adds a note; null when the ticket does not exist. */
export async function addNote(ticketId: number, authorId: number, body: string): Promise<InternalNote | null> {
  const db = getDb();
  const [ticket] = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) return null;
  const [row] = await db.insert(internalNotes).values({ ticketId, authorId, body }).returning();
  const [author] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, authorId));
  await publish({ type: "note.created", ticketId, noteId: row.id, authorId });
  return { id: row.id, ticketId, author, body: row.body, createdAt: row.createdAt };
}

/** A ticket's notes, oldest first. */
export async function listNotes(ticketId: number): Promise<InternalNote[]> {
  return getDb()
    .select({
      id: internalNotes.id,
      ticketId: internalNotes.ticketId,
      author: { id: users.id, name: users.name, email: users.email },
      body: internalNotes.body,
      createdAt: internalNotes.createdAt,
    })
    .from(internalNotes)
    .innerJoin(users, eq(users.id, internalNotes.authorId))
    .where(eq(internalNotes.ticketId, ticketId))
    .orderBy(asc(internalNotes.createdAt), asc(internalNotes.id));
}
