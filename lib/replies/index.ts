// Sending and listing replies. A reply is an outbound message in `messages`, queued for the
// `mail.send` job.
import { and, asc, desc, eq, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { publish } from "@/lib/events";
import { messages, tickets, users, type MessageStatus, type UserRef } from "@/lib/db/schema";
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

/** An outbound message as the replies API shows it (`id` is the message id). */
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
 * Queues a reply. In one transaction it inserts a `queued` outbound message with its own Message-ID and threading headers, and enqueues `mail.send`. The ticket becomes
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

    // Thread under the newest message (the customer's email or our last reply), and reference
    // the whole conversation: clients thread on any id they hold, so consecutive replies group
    // together even when the customer's original isn't in the mailbox. Failed replies never went out.
    const thread = await tx
      .select({ messageId: messages.messageId, references: messages.references })
      .from(messages)
      .where(
        and(
          eq(messages.ticketId, ticketId),
          isNotNull(messages.messageId),
          or(eq(messages.direction, "inbound"), notInArray(messages.status, ["failed", "bounced"])),
        ),
      )
      .orderBy(asc(messages.occurredAt), asc(messages.id));
    const ids = thread.flatMap((m) => [...(m.references ?? "").split(/\s+/).filter(Boolean), m.messageId!]).map(angleId);
    const inReplyTo = thread.length ? angleId(thread.at(-1)!.messageId!) : null;
    const references = inReplyTo ? referencesHeader([...new Set([...ids.filter((i) => i !== inReplyTo), inReplyTo])]) : null;

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
      // The same key already used on another ticket (the lock above only orders sends per ticket).
      .onConflictDoNothing({ target: messages.idempotencyKey })
      .returning({ id: messages.id });
    if (!message) return false;
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

  const [{ status, ...reply }] = await selectReplies().where(eq(messages.idempotencyKey, input.idempotencyKey)).limit(1);
  if (reply.ticketId !== ticketId) throw new IdempotencyConflictError();
  return { reply, message: { id: reply.id, status: status! }, created };
}

/** Every reply (outbound message) on a ticket, oldest first, with its sender. */
export async function listReplies(ticketId: number): Promise<Reply[]> {
  const rows = await selectReplies()
    .where(and(eq(messages.ticketId, ticketId), eq(messages.direction, "outbound")))
    .orderBy(asc(messages.occurredAt), asc(messages.id));
  return rows.map(({ status: _status, ...reply }) => reply);
}

function selectReplies() {
  return getDb()
    .select({
      id: messages.id,
      ticketId: messages.ticketId,
      aiDraft: messages.aiDraft,
      finalBody: messages.bodyText,
      edited: sql<boolean>`coalesce(${messages.edited}, true)`,
      sentAt: messages.occurredAt,
      sentBy: { id: users.id, name: users.name, email: users.email },
      status: messages.status,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .$dynamic();
}

/** RFC 5322 References, capped for long threads: the first id (the thread root) plus the newest. */
const MAX_REFERENCES = 20;
function referencesHeader(ids: string[]): string {
  return (ids.length > MAX_REFERENCES ? [ids[0], ...ids.slice(-(MAX_REFERENCES - 1))] : ids).join(" ");
}
