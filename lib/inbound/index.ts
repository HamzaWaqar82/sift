// The one way mail comes in. Every raw inbound email (IMAP, and the dev JSON webhook through
// ingestMail) ends as exactly one outcome: a new ticket, a message appended to an existing
// conversation, a recorded bounce, or a duplicate of something already stored. Nothing is dropped
// silently: an email we cannot store throws, so the caller leaves it in the mailbox to retry.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { getDb } from "@/lib/db";
import { inboundBounces, messages, tickets, type TicketSource } from "@/lib/db/schema";
import { publish } from "@/lib/events";
import { suppressEmail } from "@/lib/mail/suppression";
import { createTicket } from "@/lib/tickets";
import { autoAssign } from "@/lib/tickets/auto-assign";
import { cleanLine, cleanText } from "@/lib/text";

/** An inbound email reduced to what we store. */
export type InboundMail = {
  messageId: string;
  from: { email: string; name: string | null };
  to: string | null;
  subject: string;
  text: string;
  html: string | null;
  inReplyTo: string | null;
  references: string[];
  source: TicketSource;
};

export type IngestResult =
  | { kind: "ticket"; ticketId: number }
  | { kind: "appended"; ticketId: number; reopened: boolean }
  | { kind: "bounce"; outboundMessageId: number | null }
  | { kind: "duplicate"; ticketId: number | null };

/** The email has no usable sender, so it can be neither a ticket nor a reply. */
export class UnprocessableEmailError extends Error {}

/** A customer reply threads by subject only within this window. */
export const SUBJECT_MATCH_DAYS = 30;
const SUBJECT_MAX = 500;
const BODY_MAX = 50_000;

export async function ingestInboundEmail(rawMime: string | Buffer): Promise<IngestResult> {
  const parsed = await simpleParser(rawMime, { skipImageLinks: true, skipTextToHtml: true });
  // A missing Message-ID gets one derived from the raw bytes, so a redelivery still dedupes.
  const messageId =
    parsed.messageId?.trim() || `<${createHash("sha256").update(rawMime).digest("hex")}@no-message-id.sift.invalid>`;

  if (isBounce(parsed)) return recordBounce(parsed, messageId);

  const from = firstAddress(parsed.from);
  if (!from?.address) throw new UnprocessableEmailError(`Inbound email ${messageId} has no sender address`);

  const notes = (parsed.attachments ?? []).map(
    (a) => `[Attachment not imported: ${cleanLine(a.filename ?? "") || a.contentType}]`,
  );
  const text = [cleanText(parsed.text ?? "").slice(0, BODY_MAX), ...notes].filter(Boolean).join("\n\n");

  return ingestMail({
    messageId,
    from: { email: from.address.toLowerCase(), name: cleanLine(from.name ?? "") || null },
    to: firstAddress(parsed.to)?.address ?? null,
    subject: cleanLine(parsed.subject ?? "").slice(0, SUBJECT_MAX) || "(no subject)",
    text: text || "(empty message)",
    html: typeof parsed.html === "string" ? parsed.html : null,
    inReplyTo: parsed.inReplyTo?.trim() || null,
    references: toList(parsed.references),
    source: "email",
  });
}

/** Threads or creates. Shared by the raw-MIME path above and the dev JSON webhook. */
export async function ingestMail(mail: InboundMail): Promise<IngestResult> {
  const known = await ticketOfMessage([mail.messageId]);
  if (known !== null) return { kind: "duplicate", ticketId: known };

  const ticketId = (await ticketOfMessage([mail.inReplyTo, ...mail.references])) ?? (await ticketBySubject(mail));
  if (ticketId === null) {
    const { ticket, created } = await createTicket({
      customerEmail: mail.from.email,
      customerName: mail.from.name,
      subject: mail.subject,
      body: mail.text,
      source: mail.source,
      externalMessageId: mail.messageId,
      email: {
        toAddress: mail.to,
        bodyHtml: mail.html,
        inReplyTo: mail.inReplyTo,
        references: mail.references.join(" ") || null,
      },
    });
    return created ? { kind: "ticket", ticketId: ticket.id } : { kind: "duplicate", ticketId: ticket.id };
  }
  return appendReply(ticketId, mail);
}

/**
 * Appends a customer reply. A replied or closed ticket reopens; the owner stays. Setting
 * last_inbound_at is what marks the current triage draft "Out of date" (lib/triage/state.ts),
 * so the AI is not called here.
 */
async function appendReply(ticketId: number, mail: InboundMail): Promise<IngestResult> {
  return getDb().transaction(async (tx) => {
    const [message] = await tx
      .insert(messages)
      .values({
        ticketId,
        direction: "inbound",
        fromAddress: mail.from.email,
        toAddress: mail.to,
        subject: mail.subject,
        bodyText: mail.text,
        bodyHtml: mail.html,
        messageId: mail.messageId,
        inReplyTo: mail.inReplyTo,
        references: mail.references.join(" ") || null,
      })
      .onConflictDoNothing({ target: messages.messageId })
      .returning({ id: messages.id, occurredAt: messages.occurredAt });
    // Lost a race with a concurrent delivery of the same email.
    if (!message) return { kind: "duplicate", ticketId } as const;

    const [before] = await tx
      .select({ status: tickets.status, assigneeId: tickets.assigneeId })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for("update");
    const reopened = before.status === "replied" || before.status === "closed";
    await tx
      .update(tickets)
      .set({ ...(reopened ? { status: "open" as const } : {}), lastInboundAt: message.occurredAt, updatedAt: sql`now()` })
      .where(eq(tickets.id, ticketId));
    // A pooled ticket the customer writes on again is routed like a new one.
    const assigneeId = before.assigneeId === null ? await autoAssign(tx, ticketId) : null;
    await publish(
      { type: "message.created", ticketId, messageId: message.id, direction: "inbound", authorId: null, authorName: null },
      tx,
    );
    if (reopened) await publish({ type: "ticket.updated", ticketId, status: "open" }, tx);
    if (assigneeId !== null) await publish({ type: "ticket.assigned", ticketId, assigneeId }, tx);
    return { kind: "appended", ticketId, reopened } as const;
  });
}

/** Message ids are stored as `<id>`, but webhook and legacy rows may lack the brackets: match both. */
function idForms(ids: (string | null | undefined)[]): string[] {
  const bare = ids.map((id) => id?.trim().replace(/^<|>$/g, "")).filter((id): id is string => !!id);
  return [...new Set(bare.flatMap((id) => [id, `<${id}>`]))];
}

/** The ticket of the newest stored message (inbound or outbound) with any of these ids. */
async function ticketOfMessage(ids: (string | null | undefined)[]): Promise<number | null> {
  const forms = idForms(ids);
  if (!forms.length) return null;
  const [row] = await getDb()
    .select({ ticketId: messages.ticketId })
    .from(messages)
    .where(inArray(messages.messageId, forms))
    .orderBy(desc(messages.occurredAt), desc(messages.id))
    .limit(1);
  return row?.ticketId ?? null;
}

/** "RE: Fwd:  Export   failing" and "Export failing" are the same conversation. */
export function normalizeSubject(subject: string): string {
  let s = subject.trim().toLowerCase().replace(/\s+/g, " ");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/^(re|fwd?|aw|sv|antw)(\[\d+\])?\s*:\s*/i, "").trim();
  }
  return s === "(no subject)" ? "" : s;
}

/** Fallback for clients that drop threading headers: same sender, same subject, active in the window. */
async function ticketBySubject(mail: InboundMail): Promise<number | null> {
  const subject = normalizeSubject(mail.subject);
  if (!subject) return null;
  const activity = sql`greatest(${tickets.createdAt}, ${tickets.lastInboundAt}, ${tickets.lastOutboundAt})`;
  const candidates = await getDb()
    .select({ id: tickets.id, subject: tickets.subject })
    .from(tickets)
    .where(
      and(
        sql`lower(${tickets.customerEmail}) = ${mail.from.email.toLowerCase()}`,
        sql`${activity} > now() - ${SUBJECT_MATCH_DAYS} * interval '1 day'`,
      ),
    )
    .orderBy(desc(activity), desc(tickets.id))
    .limit(50);
  return candidates.find((t) => normalizeSubject(t.subject) === subject)?.id ?? null;
}

function firstAddress(field: AddressObject | AddressObject[] | undefined) {
  const list = Array.isArray(field) ? field : field ? [field] : [];
  return list.flatMap((a) => a.value).find((a) => a.address) ?? null;
}

function toList(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? value.split(/\s+/) : [];
  return list.map((v) => v.trim()).filter(Boolean);
}

// --- Bounces ---

function isBounce(parsed: ParsedMail): boolean {
  const local = firstAddress(parsed.from)?.address?.split("@")[0]?.toLowerCase();
  if (local === "mailer-daemon" || local === "postmaster") return true;
  const type = parsed.headers.get("content-type") as { value?: string; params?: Record<string, string> } | undefined;
  return type?.value === "multipart/report" && type.params?.["report-type"]?.toLowerCase() === "delivery-status";
}

/** The bounce's report parts and text, where the original Message-ID and the reason are found. */
function reportText(parsed: ParsedMail): string {
  const parts = (parsed.attachments ?? [])
    .filter((a) => /^(message\/|text\/rfc822-headers)/i.test(a.contentType))
    .map((a) => a.content.toString("utf8"));
  return [parsed.text ?? "", ...parts].join("\n");
}

/**
 * Marks the bounced reply `bounced` (with the reason as its warning), suppresses the address and
 * records the notice. Never creates a ticket. An unmatched bounce is recorded and logged.
 */
async function recordBounce(parsed: ParsedMail, messageId: string): Promise<IngestResult> {
  const report = reportText(parsed);
  const quotedIds = [...report.matchAll(/^Message-ID:\s*(<[^>\s]+>)/gim)].map((m) => m[1]);
  const forms = idForms([parsed.inReplyTo, ...toList(parsed.references), ...quotedIds]);
  const diagnostic = report.match(/^Diagnostic-Code:\s*(?:smtp;\s*)?(.+)$/im)?.[1]?.trim() ?? null;
  const reported =
    (parsed.headers.get("x-failed-recipients") as string | undefined)?.split(",")[0]?.trim() ||
    report.match(/^Final-Recipient:\s*rfc822;\s*(\S+)/im)?.[1] ||
    null;

  return getDb().transaction(async (tx) => {
    const [original] = forms.length
      ? await tx
          .select({ id: messages.id, ticketId: messages.ticketId, toAddress: messages.toAddress })
          .from(messages)
          .where(and(eq(messages.direction, "outbound"), inArray(messages.messageId, forms)))
          .orderBy(desc(messages.id))
          .limit(1)
      : [];
    const recipient = original?.toAddress ?? reported;
    const [stored] = await tx
      .insert(inboundBounces)
      .values({ messageId, outboundMessageId: original?.id ?? null, recipient, diagnostic })
      .onConflictDoNothing({ target: inboundBounces.messageId })
      .returning({ id: inboundBounces.id });
    if (!stored) return { kind: "duplicate", ticketId: original?.ticketId ?? null } as const;

    if (!original) {
      console.warn(`[inbound] bounce ${messageId} matched no sent reply (recipient ${recipient ?? "unknown"}); recorded only`);
      return { kind: "bounce", outboundMessageId: null } as const;
    }

    const warning = `The customer's mail server rejected this reply${diagnostic ? `: ${diagnostic}` : "."} ${recipient ?? "The address"} will not be mailed again.`;
    await tx.update(messages).set({ status: "bounced", lastError: warning }).where(eq(messages.id, original.id));
    if (recipient) await suppressEmail(recipient, `bounced${diagnostic ? `: ${diagnostic}` : ""}`, tx);
    // The customer never heard back: last_outbound_at falls back to the newest reply still `sent`,
    // and a ticket with none left is waiting on us again.
    await tx
      .update(tickets)
      .set({
        lastOutboundAt: sql`(select max(${messages.occurredAt}) from ${messages} where ${messages.ticketId} = ${original.ticketId} and ${messages.direction} = 'outbound' and ${messages.status} = 'sent')`,
        status: sql`case when ${tickets.status} = 'replied' and not exists (select 1 from ${messages} where ${messages.ticketId} = ${original.ticketId} and ${messages.direction} = 'outbound' and ${messages.status} = 'sent') then 'open'::ticket_status else ${tickets.status} end`,
        updatedAt: sql`now()`,
      })
      .where(eq(tickets.id, original.ticketId));
    await publish({ type: "message.status_changed", ticketId: original.ticketId, messageId: original.id, status: "bounced" }, tx);
    return { kind: "bounce", outboundMessageId: original.id } as const;
  });
}
