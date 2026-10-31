// Shared ticket queries and commands. Route handlers (form, webhook, reply, reassign) and
// pages use these instead of writing their own SQL.
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  helpArticles,
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

export const PAGE_SIZE = 20;

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
  "id" | "customerEmail" | "customerName" | "subject" | "source" | "status" | "createdAt"
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

/**
 * THE validity rule for stored triage results: a result is valid when it has no error
 * (the table's check constraint then guarantees category, urgency and draft are set).
 * Every "current triage" query uses this predicate.
 */
export function isValidTriage(): SQL {
  return isNull(triageResults.error);
}

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
 * Creates a ticket. Idempotent on `externalMessageId`: a repeat returns the existing ticket
 * with `created: false` and changes nothing.
 */
export async function createTicket(input: NewTicket): Promise<{ ticket: Ticket; created: boolean }> {
  const db = getDb();
  const [row] = await db
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

/** Sets a ticket's status. Returns the updated ticket, or null if it does not exist. */
export async function setTicketStatus(id: number, status: TicketStatus): Promise<Ticket | null> {
  const [row] = await getDb()
    .update(tickets)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(tickets.id, id))
    .returning();
  return row ?? null;
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

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid cursor");
  }
}

/** Opaque keyset cursor: the (created_at, id) of the last row on the page. */
function encodeCursor(createdAt: Date, id: number): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: number } {
  try {
    const [iso, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const createdAt = new Date(iso);
    if (typeof iso !== "string" || Number.isNaN(createdAt.getTime()) || !Number.isInteger(id)) {
      throw new Error();
    }
    return { createdAt, id };
  } catch {
    throw new InvalidCursorError();
  }
}

/**
 * One page of tickets, newest first (created_at desc, id desc), optionally filtered by status.
 * Keyset paging: rows inserted after the first page was read never shift later pages.
 * Throws InvalidCursorError for a cursor this function did not produce.
 */
export async function listTickets(opts: {
  status?: TicketStatus;
  cursor?: string;
  limit?: number;
} = {}): Promise<{ tickets: TicketListItem[]; nextCursor: string | null }> {
  const limit = opts.limit ?? PAGE_SIZE;
  const after = opts.cursor ? decodeCursor(opts.cursor) : null;

  // Per ticket: the current (latest valid) triage, else the latest failed attempt.
  const latestTriage = getDb()
    .selectDistinctOn([triageResults.ticketId], {
      ticketId: triageResults.ticketId,
      category: triageResults.category,
      urgency: triageResults.urgency,
      error: triageResults.error,
    })
    .from(triageResults)
    .orderBy(triageResults.ticketId, desc(isValidTriage()), desc(triageResults.createdAt), desc(triageResults.id))
    .as("latest_triage");

  const rows = await getDb()
    .select({
      id: tickets.id,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      subject: tickets.subject,
      source: tickets.source,
      status: tickets.status,
      createdAt: tickets.createdAt,
      assigneeId: assigneeUser.id,
      assigneeName: assigneeUser.name,
      assigneeEmail: assigneeUser.email,
      triageTicketId: latestTriage.ticketId,
      category: latestTriage.category,
      urgency: latestTriage.urgency,
    })
    .from(tickets)
    .leftJoin(assigneeUser, eq(assigneeUser.id, tickets.assigneeId))
    .leftJoin(latestTriage, eq(latestTriage.ticketId, tickets.id))
    .where(
      and(
        opts.status ? eq(tickets.status, opts.status) : undefined,
        after
          ? sql`(${tickets.createdAt}, ${tickets.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id})`
          : undefined,
      ),
    )
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).map(
    (r): TicketListItem => ({
      id: r.id,
      customerEmail: r.customerEmail,
      customerName: r.customerName,
      subject: r.subject,
      source: r.source,
      status: r.status,
      createdAt: r.createdAt,
      assignee: r.assigneeId ? { id: r.assigneeId, name: r.assigneeName!, email: r.assigneeEmail! } : null,
      triage:
        r.triageTicketId === null
          ? null
          : r.category && r.urgency
            ? { ok: true, category: r.category, urgency: r.urgency }
            : { ok: false },
    }),
  );
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null;
  return { tickets: page, nextCursor };
}
