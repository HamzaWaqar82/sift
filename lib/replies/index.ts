// Sending and listing replies. Each reply is also an outbound message in `messages`, queued for
// the `mail.send` job; `replies` is kept alongside until the contract step (ticket 16).
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { publish } from "@/lib/events";
import { messages, replies, tickets, users, type MessageStatus, type UserRef } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/jobs";
import { generateMessageId } from "@/lib/mail";
import { suppressionOf } from "@/lib/mail/suppression";
import { angleId, MAIL_SEND, type MailSendPayload } from "./delivery";
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
    /**
     * The newest message (either direction) the composer showed, or null for none. Omitted skips
     * the stale check (API clients); the app's composer always sends it.
     */
    latestMessageId: idField.nullable().optional(),
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

/** A message arrived (or another reply was queued) after the composer loaded. */
export class StaleTicketError extends Error {
  constructor() {
    super("A new message arrived on this ticket. Read it, then send again.");
  }
}

/** The customer's address is on the suppression list. */
export class SuppressedRecipientError extends Error {
  constructor(email: string, reason: string) {
    super(`Not sent: ${email} is on the suppression list (${reason}), so mail to it is blocked.`);
  }
}

export type QueuedMessage = { id: number; status: MessageStatus };

/**
 * Queues a reply. In one transaction it records the reply, inserts a `queued` outbound message
 * with its own Message-ID and threading headers, and enqueues `mail.send`. The ticket becomes
 * replied only once the job delivers it (lib/replies/delivery.ts).
 * The AI draft is loaded from the stored triage result the client says it displayed
 * (`draftTriageId`), never taken from the client, and `edited` is computed against it. So an
 * admin regenerating mid-compose does not make an unchanged send of the older draft "edited".
 * A repeat with the same idempotency key returns the original with `created: false`, before any
 * other check, so a double click never reads as stale. Throws StaleTicketError when
 * `latestMessageId` is given and is no longer the newest message.
 * Returns null when the ticket does not exist; throws UnknownDraftError for a bad draftTriageId
 * and SuppressedRecipientError for a suppressed address.
 */
export async function sendReply(
  ticketId: number,
  userId: number,
  input: ReplyInput,
): Promise<{ reply: Reply; message: QueuedMessage; created: boolean } | null> {
  if (!(await getTicket(ticketId))) return null;
  let aiDraft: string | null = null;
  if (input.draftTriageId !== null) {
    const shown = await getValidTriage(ticketId, input.draftTriageId);
    if (!shown) throw new UnknownDraftError();
    aiDraft = shown.draft;
  }
  const edited = aiDraft === null || input.body !== cleanText(aiDraft);

  const created = await getDb().transaction(async (tx) => {
    // Sends on one ticket take turns, so the repeat and stale checks see each other's inserts.
    const [ticket] = await tx
      .select({ customerEmail: tickets.customerEmail, subject: tickets.subject })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for("update");
    const [repeat] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.idempotencyKey, input.idempotencyKey));
    if (repeat) return false;

    if (input.latestMessageId !== undefined) {
      const [latest] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.ticketId, ticketId))
        .orderBy(desc(messages.occurredAt), desc(messages.id))
        .limit(1);
      if ((latest?.id ?? null) !== input.latestMessageId) throw new StaleTicketError();
    }
    const suppressed = await suppressionOf(ticket.customerEmail, tx);
    if (suppressed) throw new SuppressedRecipientError(ticket.customerEmail, suppressed.reason);

    const [row] = await tx
      .insert(replies)
      .values({ ticketId, aiDraft, finalBody: input.body, sentBy: userId, edited, idempotencyKey: input.idempotencyKey })
      .onConflictDoNothing({ target: replies.idempotencyKey })
      .returning({ id: replies.id });
    if (!row) return false;

    // Thread under the customer's latest email that has a Message-ID.
    const [parent] = await tx
      .select({ messageId: messages.messageId, references: messages.references })
      .from(messages)
      .where(and(eq(messages.ticketId, ticketId), eq(messages.direction, "inbound"), isNotNull(messages.messageId)))
      .orderBy(desc(messages.occurredAt), desc(messages.id))
      .limit(1);
    const inReplyTo = parent?.messageId ? angleId(parent.messageId) : null;
    const chain = (parent?.references ?? "").split(/\s+/).filter(Boolean).map(angleId);
    const references = inReplyTo ? [...new Set([...chain, inReplyTo])].join(" ") : null;

    const [message] = await tx
      .insert(messages)
      .values({
        ticketId,
        direction: "outbound",
        authorId: userId,
        toAddress: ticket.customerEmail,
        subject: `Re: ${ticket.subject.replace(/^(\s*re:\s*)+/i, "")}`,
        bodyText: input.body,
        messageId: generateMessageId(),
        inReplyTo,
        references,
        status: "queued",
        aiDraft,
        edited,
        idempotencyKey: input.idempotencyKey,
      })
      .returning({ id: messages.id });
    await enqueueJob(MAIL_SEND, { messageId: message.id } satisfies MailSendPayload, {}, tx);
    const [author] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await publish(
      {
        type: "message.created",
        ticketId,
        messageId: message.id,
        direction: "outbound",
        authorId: userId,
        authorName: author?.name ?? null,
      },
      tx,
    );
    return true;
  });

  const [reply] = await selectReplies().where(eq(replies.idempotencyKey, input.idempotencyKey)).limit(1);
  if (reply.ticketId !== ticketId) throw new IdempotencyConflictError();
  const [message] = await getDb()
    .select({ id: messages.id, status: messages.status })
    .from(messages)
    .where(eq(messages.idempotencyKey, input.idempotencyKey));
  return { reply, message: { id: message.id, status: message.status! }, created };
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
