// Reading a ticket's conversation. Writes happen where tickets are created, replies are sent and
// inbound mail is ingested.
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { messages, users, type MessageDirection, type MessageStatus, type UserRef } from "@/lib/db/schema";

export type Message = {
  id: number;
  ticketId: number;
  direction: MessageDirection;
  /** The staff user who wrote an outbound message; null when inbound. */
  author: UserRef | null;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string;
  bodyText: string;
  occurredAt: Date;
  /** Delivery state of an outbound message; null when inbound. */
  status: MessageStatus | null;
  /** Why the last delivery try failed (outbound only). */
  lastError: string | null;
  aiDraft: string | null;
  edited: boolean | null;
  idempotencyKey: string | null;
};

/** Every message of a ticket, oldest first. */
export async function listMessages(ticketId: number): Promise<Message[]> {
  const rows = await getDb()
    .select({
      id: messages.id,
      ticketId: messages.ticketId,
      direction: messages.direction,
      author: { id: users.id, name: users.name, email: users.email },
      fromAddress: messages.fromAddress,
      toAddress: messages.toAddress,
      subject: messages.subject,
      bodyText: messages.bodyText,
      occurredAt: messages.occurredAt,
      status: messages.status,
      lastError: messages.lastError,
      aiDraft: messages.aiDraft,
      edited: messages.edited,
      idempotencyKey: messages.idempotencyKey,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.ticketId, ticketId))
    .orderBy(asc(messages.occurredAt), asc(messages.id));
  return rows.map((r) => ({ ...r, author: r.author?.id ? r.author : null }));
}

/** The customer's most recent message on a ticket, or null. */
export async function latestInboundMessage(ticketId: number): Promise<{ subject: string; bodyText: string } | null> {
  const [row] = await getDb()
    .select({ subject: messages.subject, bodyText: messages.bodyText })
    .from(messages)
    .where(and(eq(messages.ticketId, ticketId), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.occurredAt), desc(messages.id))
    .limit(1);
  return row ?? null;
}
