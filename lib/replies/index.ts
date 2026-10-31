// Sending and listing replies. Replies are recorded in the app only; no email is delivered.
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { replies, tickets, users } from "@/lib/db/schema";
import { getTicket, type TicketDetail } from "@/lib/tickets";

export const replyInputSchema = z.object({
  body: z
    .string()
    .max(20_000, "Reply must be 20,000 characters or fewer")
    .refine((s) => s.trim().length > 0, "Reply cannot be empty"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type ReplyInput = z.infer<typeof replyInputSchema>;

export type Reply = {
  id: number;
  ticketId: number;
  aiDraft: string | null;
  finalBody: string;
  edited: boolean;
  sentAt: Date;
  sentBy: { id: number; name: string; email: string };
};

/** The draft the reply box starts with: the latest triage's draft when that triage is valid. */
export function currentDraft(ticket: Pick<TicketDetail, "triage">): string | null {
  const t = ticket.triage;
  return t && t.error === null ? t.draft : null;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for another ticket");
  }
}

/**
 * Records a reply and sets the ticket to replied, in one transaction.
 * The AI draft and the edited flag are taken from the stored triage, never from the client.
 * A repeat with the same idempotency key returns the original reply with `created: false`.
 * Returns null when the ticket does not exist.
 */
export async function sendReply(
  ticketId: number,
  userId: number,
  input: ReplyInput,
): Promise<{ reply: Reply; created: boolean } | null> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return null;
  const aiDraft = currentDraft(ticket);
  const edited = aiDraft === null || input.body !== aiDraft;

  const created = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(replies)
      .values({ ticketId, aiDraft, finalBody: input.body, sentBy: userId, edited, idempotencyKey: input.idempotencyKey })
      .onConflictDoNothing({ target: replies.idempotencyKey })
      .returning({ id: replies.id });
    if (!row) return false;
    await tx.update(tickets).set({ status: "replied", updatedAt: sql`now()` }).where(eq(tickets.id, ticketId));
    return true;
  });

  const [reply] = await selectReplies().where(eq(replies.idempotencyKey, input.idempotencyKey)).limit(1);
  if (reply.ticketId !== ticketId) throw new IdempotencyConflictError();
  return { reply, created };
}

/** Every reply on a ticket, oldest first, with its sender. */
export async function listReplies(ticketId: number): Promise<Reply[]> {
  return selectReplies().where(eq(replies.ticketId, ticketId)).orderBy(asc(replies.sentAt), asc(replies.id));
}

function selectReplies() {
  return getDb()
    .select({
      id: replies.id,
      ticketId: replies.ticketId,
      aiDraft: replies.aiDraft,
      finalBody: replies.finalBody,
      edited: replies.edited,
      sentAt: replies.sentAt,
      sentBy: { id: users.id, name: users.name, email: users.email },
    })
    .from(replies)
    .innerJoin(users, eq(users.id, replies.sentBy))
    .$dynamic();
}
