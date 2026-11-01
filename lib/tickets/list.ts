// Ticket list, board and summary queries: one filter model (search, status, assignee, triage
// category/urgency, source), three sorts with keyset paging, and per-status counts.
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  messages,
  ticketStatus,
  tickets,
  triageResults,
  users,
  type TicketSource,
  type TicketStatus,
  type TriageCategory,
  type TriageUrgency,
} from "@/lib/db/schema";
import type { TicketListItem } from "./index";
import { overdueCondition, overdueWaitingSince } from "./overdue";
import { isValidTriage } from "./triage-rule";

export const PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const SEARCH_MAX_LENGTH = 100;

/** `overdue`: overdue tickets first, then newest (the *Needs an owner* view). */
export type TicketSort = "newest" | "oldest" | "updated" | "overdue";

export type TicketFilters = {
  /** Case-insensitive substring over subject, body, customer name and customer email. */
  q?: string;
  /** Any of these statuses. */
  status?: TicketStatus[];
  /** A user id, or "unassigned". */
  assignee?: number | "unassigned";
  /** Category / urgency of the ticket's current (latest VALID) triage; untriaged tickets never match. */
  category?: TriageCategory[];
  urgency?: TriageUrgency[];
  source?: TicketSource;
  /** Only overdue tickets (see overdueCondition). */
  overdue?: boolean;
};

export type ListOptions = TicketFilters & { sort?: TicketSort; cursor?: string; limit?: number };

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid cursor");
  }
}

const assigneeUser = alias(users, "assignee");

/** Per ticket: the current (latest valid) triage, else the latest failed attempt. */
function latestTriageSubquery() {
  return getDb()
    .selectDistinctOn([triageResults.ticketId], {
      ticketId: triageResults.ticketId,
      category: triageResults.category,
      urgency: triageResults.urgency,
      error: triageResults.error,
    })
    .from(triageResults)
    .orderBy(triageResults.ticketId, desc(isValidTriage()), desc(triageResults.createdAt), desc(triageResults.id))
    .as("latest_triage");
}
type LatestTriage = ReturnType<typeof latestTriageSubquery>;

/** Escapes LIKE wildcards so user text is matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function filterConditions(f: TicketFilters, latest: LatestTriage, opts: { ignoreStatus?: boolean } = {}): (SQL | undefined)[] {
  const q = f.q?.trim().slice(0, SEARCH_MAX_LENGTH);
  const pattern = q ? `%${escapeLike(q)}%` : null;
  return [
    pattern
      ? or(
          ilike(tickets.subject, pattern),
          // Every message of the thread, inbound and outbound (the first one is the ticket body).
          sql`exists (select 1 from ${messages} where ${messages.ticketId} = ${tickets.id} and ${messages.bodyText} ilike ${pattern})`,
          ilike(tickets.customerName, pattern),
          ilike(tickets.customerEmail, pattern),
        )
      : undefined,
    !opts.ignoreStatus && f.status?.length ? inArray(tickets.status, f.status) : undefined,
    f.assignee === "unassigned"
      ? isNull(tickets.assigneeId)
      : typeof f.assignee === "number"
        ? eq(tickets.assigneeId, f.assignee)
        : undefined,
    f.category?.length ? inArray(latest.category, f.category) : undefined,
    f.urgency?.length ? inArray(latest.urgency, f.urgency) : undefined,
    f.source ? eq(tickets.source, f.source) : undefined,
    f.overdue ? overdueCondition() : undefined,
  ];
}

const SORTS = {
  newest: { column: tickets.createdAt, dir: "desc" },
  oldest: { column: tickets.createdAt, dir: "asc" },
  updated: { column: tickets.updatedAt, dir: "desc" },
  overdue: { column: tickets.createdAt, dir: "desc" },
} as const;

/** The `overdue` sort's leading key. Never null, so it is safe in a keyset row comparison. */
const isOverdue = () => sql<boolean>`coalesce((${overdueCondition()}), false)`;

/** Opaque keyset cursor: [sort, sort-key timestamp, id, overdue?] of the last row on the page. */
function encodeCursor(sort: TicketSort, key: Date, id: number, overdue: boolean): string {
  return Buffer.from(JSON.stringify([sort, key.toISOString(), id, ...(sort === "overdue" ? [overdue] : [])])).toString("base64url");
}

function decodeCursor(cursor: string, sort: TicketSort): { key: Date; id: number; overdue: boolean } {
  try {
    const [cursorSort, iso, id, overdue = false] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const key = new Date(iso);
    if (
      cursorSort !== sort ||
      typeof overdue !== "boolean" ||
      typeof iso !== "string" ||
      Number.isNaN(key.getTime()) ||
      !Number.isInteger(id) ||
      id < 1 ||
      id > 2_147_483_647
    ) {
      throw new Error();
    }
    return { key, id, overdue };
  } catch {
    throw new InvalidCursorError();
  }
}

/**
 * One page of tickets matching the filters. Keyset paging on (sort key, id), so rows inserted
 * between pages never shift later pages: newest = created_at desc, oldest = created_at asc,
 * updated = updated_at desc (a ticket updated while you page may move; it never crashes paging).
 * Throws InvalidCursorError for a cursor this function did not produce for this sort.
 */
export async function listTickets(opts: ListOptions = {}): Promise<{ tickets: TicketListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const sort = opts.sort ?? "newest";
  const { column, dir } = SORTS[sort];
  const after = opts.cursor ? decodeCursor(opts.cursor, sort) : null;
  const latest = latestTriageSubquery();

  const rows = await getDb()
    .select({
      id: tickets.id,
      customerEmail: tickets.customerEmail,
      customerName: tickets.customerName,
      subject: tickets.subject,
      source: tickets.source,
      status: tickets.status,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      assigneeId: assigneeUser.id,
      assigneeName: assigneeUser.name,
      assigneeEmail: assigneeUser.email,
      triageTicketId: latest.ticketId,
      category: latest.category,
      urgency: latest.urgency,
      overdueWaitingSince: overdueWaitingSince(),
    })
    .from(tickets)
    .leftJoin(assigneeUser, eq(assigneeUser.id, tickets.assigneeId))
    .leftJoin(latest, eq(latest.ticketId, tickets.id))
    .where(
      and(
        ...filterConditions(opts, latest),
        after && sort === "overdue"
          ? sql`(${isOverdue()}, ${column}, ${tickets.id}) < (${after.overdue}, ${after.key.toISOString()}::timestamptz, ${after.id})`
          : after
            ? sql`(${column}, ${tickets.id}) ${sql.raw(dir === "desc" ? "<" : ">")} (${after.key.toISOString()}::timestamptz, ${after.id})`
            : undefined,
      ),
    )
    .orderBy(
      ...(sort === "overdue" ? [desc(isOverdue())] : []),
      dir === "desc" ? desc(column) : asc(column),
      dir === "desc" ? desc(tickets.id) : asc(tickets.id),
    )
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
      updatedAt: r.updatedAt,
      overdueWaitingSince: r.overdueWaitingSince,
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
  const nextCursor =
    rows.length > limit && last ? encodeCursor(sort, sort === "updated" ? last.updatedAt : last.createdAt, last.id, last.overdueWaitingSince !== null) : null;
  return { tickets: page, nextCursor };
}

/** Matching ticket counts per status. `status` in the filters is ignored (every status is counted). */
export async function ticketSummary(filters: TicketFilters = {}): Promise<{ total: number; byStatus: Record<TicketStatus, number> }> {
  const latest = latestTriageSubquery();
  const rows = await getDb()
    .select({ status: tickets.status, count: sql<number>`count(*)::int` })
    .from(tickets)
    .leftJoin(latest, eq(latest.ticketId, tickets.id))
    .where(and(...filterConditions(filters, latest, { ignoreStatus: true })))
    .groupBy(tickets.status);
  const byStatus = Object.fromEntries(ticketStatus.enumValues.map((s) => [s, 0])) as Record<TicketStatus, number>;
  for (const r of rows) byStatus[r.status] = r.count;
  return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
}

export type BoardColumn = { count: number; tickets: TicketListItem[]; nextCursor: string | null };

/**
 * Tickets grouped by status. Each column has the total number of matches (`count`), its first
 * `limit` tickets and a `nextCursor` to load more (pass it back as that column's cursor).
 * A `status` filter limits which columns are returned. Counts ignore cursors.
 */
export async function boardTickets(
  opts: Omit<ListOptions, "cursor"> & { cursors?: Partial<Record<TicketStatus, string>> } = {},
): Promise<{ columns: Partial<Record<TicketStatus, BoardColumn>> }> {
  const { cursors, status, ...rest } = opts;
  const statuses = status?.length ? ticketStatus.enumValues.filter((s) => status.includes(s)) : ticketStatus.enumValues;
  const counts = (await ticketSummary(rest)).byStatus;
  const entries = await Promise.all(
    statuses.map(async (s) => {
      const page = await listTickets({ ...rest, status: [s], cursor: cursors?.[s] });
      return [s, { count: counts[s], tickets: page.tickets, nextCursor: page.nextCursor }] as const;
    }),
  );
  return { columns: Object.fromEntries(entries) };
}
