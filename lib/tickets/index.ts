// Shared ticket queries and commands. Route handlers (form, webhook, reply, reassign) and
// pages use these instead of writing their own SQL.
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  helpArticles,
  messages,
  replies,
  tickets,
  triageResults,
  users,
  type HelpArticle,
  type TicketSource,
  type TicketStatus,
  type TriageCategory,
  type TriageUrgency,
  type UserRef,
} from "@/lib/db/schema";

import { isValidTriage } from "./triage-rule";

export { isValidTriage };
export { PAGE_SIZE, InvalidCursorError, listTickets, boardTickets, ticketSummary } from "./list";

export type NewTicket = {
  customerEmail: string;
  customerName?: string | null;
  subject: string;
  body: string;
  source: TicketSource;
  /** Inbound email message id. When it already exists, the existing ticket is returned instead. */
  externalMessageId?: string | null;
  /** Defaults to now (the webhook and form always use now). Tests set it for deterministic order. */
  createdAt?: Date;
};

export type Ticket = typeof tickets.$inferSelect;

export type Assignee = UserRef | null;

/** List badge: the current (latest valid) triage, `{ok: false}` when every attempt failed, null if never triaged. */
export type TriageSummary =
  | { ok: true; category: TriageCategory; urgency: TriageUrgency }
  | { ok: false }
  | null;

export type TicketListItem = Pick<
  Ticket,
  "id" | "customerEmail" | "customerName" | "subject" | "source" | "status" | "createdAt" | "updatedAt"
> & { assignee: Assignee; triage: TriageSummary };

/** A valid triage result with the help article it cites (null: the draft is ungrounded). */
export type CurrentTriage = {
  id: number;
  category: TriageCategory;
  urgency: TriageUrgency;
  draft: string;
  model: string;
  createdAt: Date;
  article: HelpArticle | null;
};

export type TicketDetail = Ticket & {
  assignee: Assignee;
  /** The ticket's current triage: its latest VALID result (see getCurrentTriage), or null. */
  currentTriage: CurrentTriage | null;
  /**
   * The help article behind the current triage. null: no valid triage yet.
   * `{ article: null }`: the draft is ungrounded (the AI cited no article).
   */
  grounding: Grounding;
};

export type Grounding = { article: HelpArticle | null } | null;

function selectValidTriage() {
  return getDb()
    .select({
      id: triageResults.id,
      category: triageResults.category,
      urgency: triageResults.urgency,
      draft: triageResults.draft,
      model: triageResults.model,
      createdAt: triageResults.createdAt,
      article: { id: helpArticles.id, title: helpArticles.title, body: helpArticles.body },
    })
    .from(triageResults)
    .leftJoin(helpArticles, eq(helpArticles.id, triageResults.articleId))
    .$dynamic();
}

type ValidTriageRow = Awaited<ReturnType<typeof selectValidTriage>>[number];

function toCurrentTriage(row: ValidTriageRow | undefined): CurrentTriage | null {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category!,
    urgency: row.urgency!,
    draft: row.draft!,
    model: row.model,
    createdAt: row.createdAt,
    article: row.article?.id ? row.article : null,
  };
}

/**
 * The ticket's current triage: its latest VALID result, or null. A later failed attempt
 * (e.g. a failed admin regenerate) does not replace it. The reply draft prefill, the article
 * panel, the list badges and the triage cache all follow this one rule.
 */
export async function getCurrentTriage(ticketId: number): Promise<CurrentTriage | null> {
  const [row] = await selectValidTriage()
    .where(and(eq(triageResults.ticketId, ticketId), isValidTriage()))
    .orderBy(desc(triageResults.createdAt), desc(triageResults.id))
    .limit(1);
  return toCurrentTriage(row);
}

/** One specific valid triage result of this ticket, or null (unknown id, another ticket's, or failed). */
export async function getValidTriage(ticketId: number, triageId: number): Promise<CurrentTriage | null> {
  const [row] = await selectValidTriage()
    .where(and(eq(triageResults.id, triageId), eq(triageResults.ticketId, ticketId), isValidTriage()))
    .limit(1);
  return toCurrentTriage(row);
}

/**
 * Creates a ticket and its first inbound message, in one transaction. Idempotent on
 * `externalMessageId`: a repeat returns the existing ticket with `created: false` and changes nothing.
 */
export async function createTicket(input: NewTicket): Promise<{ ticket: Ticket; created: boolean }> {
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        customerEmail: input.customerEmail,
        customerName: input.customerName ?? null,
        subject: input.subject,
        body: input.body,
        source: input.source,
        externalMessageId: input.externalMessageId ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
      })
      .onConflictDoNothing({ target: tickets.externalMessageId })
      .returning();
    if (!ticket) return null;
    await tx.insert(messages).values({
      ticketId: ticket.id,
      direction: "inbound",
      fromAddress: ticket.customerEmail,
      subject: ticket.subject,
      bodyText: ticket.body,
      messageId: ticket.externalMessageId,
      occurredAt: ticket.createdAt,
    });
    const [withInbound] = await tx
      .update(tickets)
      .set({ lastInboundAt: ticket.createdAt })
      .where(eq(tickets.id, ticket.id))
      .returning();
    return withInbound;
  });
  if (row) return { ticket: row, created: true };

  const [existing] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.externalMessageId, input.externalMessageId!))
    .limit(1);
  return { ticket: existing, created: false };
}

const assigneeUser = alias(users, "assignee");

/** One ticket with its assignee and current triage, or null. */
export async function getTicket(id: number): Promise<TicketDetail | null> {
  const db = getDb();
  const [row] = await db
    .select({
      ticket: tickets,
      assignee: { id: assigneeUser.id, name: assigneeUser.name, email: assigneeUser.email },
    })
    .from(tickets)
    .leftJoin(assigneeUser, eq(assigneeUser.id, tickets.assigneeId))
    .where(eq(tickets.id, id))
    .limit(1);
  if (!row) return null;

  const currentTriage = await getCurrentTriage(id);
  return {
    ...row.ticket,
    assignee: row.assignee?.id ? row.assignee : null,
    currentTriage,
    grounding: currentTriage ? { article: currentTriage.article } : null,
  };
}

export type CloseResult =
  | { ok: true; ticket: Ticket }
  | { ok: false; reason: "not-found" | "reply_required" };

/**
 * Closes a ticket. THE close rule: unless `anyTicket` (admins), the ticket must have at least one
 * sent reply. Closing an already-closed ticket succeeds and changes nothing.
 */
export async function closeTicket(id: number, opts: { anyTicket: boolean }): Promise<CloseResult> {
  const db = getDb();
  const hasReply = sql`exists (select 1 from ${replies} where ${replies.ticketId} = ${tickets.id})`;
  const [closed] = await db
    .update(tickets)
    .set({ status: "closed", updatedAt: sql`now()` })
    .where(and(eq(tickets.id, id), ne(tickets.status, "closed"), opts.anyTicket ? undefined : hasReply))
    .returning();
  if (closed) return { ok: true, ticket: closed };

  const [existing] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!existing) return { ok: false, reason: "not-found" };
  return existing.status === "closed" ? { ok: true, ticket: existing } : { ok: false, reason: "reply_required" };
}

export type ReopenResult = { ok: true; ticket: Ticket } | { ok: false; reason: "not-found" | "not_closed" };

/** Reopens a closed ticket (closed -> open). Any other status is refused with "not_closed". */
export async function reopenTicket(id: number): Promise<ReopenResult> {
  const db = getDb();
  const [reopened] = await db
    .update(tickets)
    .set({ status: "open", updatedAt: sql`now()` })
    .where(and(eq(tickets.id, id), eq(tickets.status, "closed")))
    .returning();
  if (reopened) return { ok: true, ticket: reopened };
  const [existing] = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, id)).limit(1);
  return { ok: false, reason: existing ? "not_closed" : "not-found" };
}

/**
 * Sets (or clears, with null) a ticket's assignee. Callers must check the admin role first.
 * Returns the updated ticket detail, or why it could not be assigned.
 */
export async function assignTicket(
  id: number,
  assigneeId: number | null,
): Promise<{ ok: true; ticket: TicketDetail } | { ok: false; reason: "ticket-not-found" | "unknown-user" }> {
  const db = getDb();
  if (assigneeId !== null) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, assigneeId)).limit(1);
    if (!user) return { ok: false, reason: "unknown-user" };
  }
  const [row] = await db
    .update(tickets)
    .set({ assigneeId, updatedAt: sql`now()` })
    .where(eq(tickets.id, id))
    .returning({ id: tickets.id });
  if (!row) return { ok: false, reason: "ticket-not-found" };
  return { ok: true, ticket: (await getTicket(id))! };
}

/** Every staff user, for the admin's assignee picker. */
export async function listAssignableUsers(): Promise<UserRef[]> {
  return getDb().select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(users.name);
}
