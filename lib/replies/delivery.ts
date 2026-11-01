// Delivering a queued outbound message (the `mail.send` job) and its state changes. A message is
// `queued` until the job claims it, `sending` while the Mailer has it, then `sent` (the provider
// accepted it) or, once retries run out, `failed`. Only `sent` moves the ticket to replied and
// advances last_outbound_at, so a reply that never went out never clears the overdue marker.
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { messages, tickets, type MessageStatus } from "@/lib/db/schema";
import { publish } from "@/lib/events";
import { enqueueJob } from "@/lib/jobs/queue";
import { getMailer } from "@/lib/mail";
import { suppressionOf } from "@/lib/mail/suppression";

export const MAIL_SEND = "mail.send";
export type MailSendPayload = { messageId: number };

/** Message ids look like `<local@domain>`; webhook and legacy ids may lack the brackets. */
export function angleId(id: string): string {
  return `<${id.trim().replace(/^<|>$/g, "")}>`;
}

/** Runs one delivery attempt. Throws on a transport error so the job retries with backoff. */
export async function deliverMessage(messageId: number, attempt: { final: boolean }): Promise<void> {
  const db = getDb();
  // Claim. `sending` is accepted too: that is a try whose worker died, recovered by the job queue.
  // A sent, failed or bounced message is never mailed by a stray job.
  const [msg] = await db
    .update(messages)
    .set({ status: "sending", attempts: sql`${messages.attempts} + 1` })
    .where(
      and(eq(messages.id, messageId), eq(messages.direction, "outbound"), inArray(messages.status, ["queued", "sending"])),
    )
    .returning();
  if (!msg) return;
  await statusChanged(msg.ticketId, msg.id, "sending");

  const suppressed = msg.toAddress ? await suppressionOf(msg.toAddress) : null;
  if (!msg.toAddress || suppressed) {
    await markFailed(messageId, msg.toAddress ? `${msg.toAddress} is suppressed (${suppressed!.reason})` : "No recipient");
    return;
  }

  let providerId: string;
  try {
    providerId = await getMailer().send({
      to: msg.toAddress,
      subject: msg.subject,
      text: msg.bodyText,
      html: msg.bodyHtml ?? undefined,
      messageId: msg.messageId ?? undefined,
      inReplyTo: msg.inReplyTo ?? undefined,
      references: msg.references ? msg.references.split(/\s+/).filter(Boolean) : undefined,
    });
  } catch (error) {
    const lastError = error instanceof Error ? error.message || error.name : String(error);
    // The last try leaves the message for onFailed to mark failed; earlier ones go back to queued.
    await db
      .update(messages)
      .set({ status: attempt.final ? "sending" : "queued", lastError })
      .where(eq(messages.id, messageId));
    if (!attempt.final) await statusChanged(msg.ticketId, msg.id, "queued");
    throw error;
  }

  // A crash between the provider accepting and this commit makes the job run again and resend:
  // at-least-once, with the same Message-ID so clients thread the duplicate.
  await db.transaction(async (tx) => {
    await tx
      .update(messages)
      .set({ status: "sent", providerMessageId: providerId, lastError: null })
      .where(eq(messages.id, messageId));
    await tx
      .update(tickets)
      .set({ status: "replied", lastOutboundAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(tickets.id, msg.ticketId));
    await statusChanged(msg.ticketId, msg.id, "sent", tx);
    await publish({ type: "ticket.updated", ticketId: msg.ticketId, status: "replied" }, tx);
  });
}

/** Retries are spent (or the address is suppressed): the reply shows *Failed — Retry*. */
export async function markFailed(messageId: number, lastError: string): Promise<void> {
  const [msg] = await getDb()
    .update(messages)
    .set({ status: "failed", lastError })
    .where(and(eq(messages.id, messageId), inArray(messages.status, ["queued", "sending"])))
    .returning({ ticketId: messages.ticketId });
  if (msg) await statusChanged(msg.ticketId, messageId, "failed");
}

/**
 * Manual retry of a failed reply: back to queued with a fresh job (fresh attempts).
 * Returns null when the message is not a failed outbound message of this ticket.
 */
export async function retryMessage(ticketId: number, messageId: number): Promise<{ id: number; status: MessageStatus } | null> {
  return getDb().transaction(async (tx) => {
    const [msg] = await tx
      .update(messages)
      .set({ status: "queued" })
      .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId), eq(messages.status, "failed")))
      .returning({ id: messages.id, status: messages.status });
    if (!msg) return null;
    await enqueueJob(MAIL_SEND, { messageId } satisfies MailSendPayload, {}, tx);
    await statusChanged(ticketId, messageId, "queued", tx);
    return { id: msg.id, status: msg.status! };
  });
}

function statusChanged(ticketId: number, messageId: number, status: MessageStatus, db?: Parameters<typeof publish>[1]) {
  return publish({ type: "message.status_changed", ticketId, messageId, status }, db);
}
