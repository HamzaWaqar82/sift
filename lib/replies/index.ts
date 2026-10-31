// Sending and listing replies. Replies are recorded in the app only; no email is delivered.
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { replies, tickets, users, type UserRef } from "@/lib/db/schema";
import { getTicket, getValidTriage } from "@/lib/tickets";
import { cleanLine, cleanText } from "@/lib/text";
import { idField } from "@/lib/validation";

export const replyInputSchema = z
  .object({
    /** Sanitised but not trimmed, so an unchanged AI draft still compares equal. */
    body: z
      .string()
      .transform(cleanText)
      .pipe(
        z
          .string()
          .max(20_000, "Reply must be 20,000 characters or fewer")
          .refine((s) => s.trim().length > 0, "Reply cannot be empty"),
      ),
    idempotencyKey: z
      .string()
      .transform(cleanLine)
      .pipe(z.string().trim().min(8, "idempotencyKey must be at least 8 characters").max(200, "idempotencyKey is too long")),
    /**
     * The triage result whose draft the reply box started from (the `draftTriageId` the client
     * was given), or null when no AI draft was shown. Omitted means null.
     */
    draftTriageId: idField.nullable().default(null),
  })
  .strict();

export type ReplyInput = z.infer<typeof replyInputSchema>;

export type Reply = {
  id: number;
  ticketId: number;
  aiDraft: string | null;
  finalBody: string;
  edited: boolean;
  sentAt: Date;
  sentBy: UserRef;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for another ticket");
  }
}

/** `draftTriageId` is not a valid triage result of this ticket. */
export class UnknownDraftError extends Error {
  constructor() {
    super("draftTriageId is not a valid triage result of this ticket");
  }
}

/**
 * Records a reply and sets the ticket to replied, in one transaction.
 * The AI draft is loaded from the stored triage result the client says it displayed
 * (`draftTriageId`), never taken from the client, and `edited` is computed against it. So an
 * admin regenerating mid-compose does not make an unchanged send of the older draft "edited".
 * A repeat with the same idempotency key returns the original reply with `created: false`.
 * Returns null when the ticket does not exist; throws UnknownDraftError for a bad draftTriageId.
 */
export async function sendReply(
  ticketId: number,
  userId: number,
  input: ReplyInput,
): Promise<{ reply: Reply; created: boolean } | null> {
  if (!(await getTicket(ticketId))) return null;
  let aiDraft: string | null = null;
  if (input.draftTriageId !== null) {
    const shown = await getValidTriage(ticketId, input.draftTriageId);
    if (!shown) throw new UnknownDraftError();
    aiDraft = shown.draft;
  }
  const edited = aiDraft === null || input.body !== cleanText(aiDraft);

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
