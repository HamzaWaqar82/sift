// Parsing and validating the query string of GET /api/tickets, /board and /summary
// (and the list page's search params, which use the same names).
import { z } from "zod";
import { ticketSource, triageCategory, triageUrgency } from "@/lib/db/schema";
import { cleanLine } from "@/lib/text";
import { fieldErrors } from "@/lib/validation";
import { MAX_PAGE_SIZE, PAGE_SIZE, SEARCH_MAX_LENGTH, type ListOptions } from "./list";
import { TICKET_STATUSES } from "./schema";

/** A comma-separated list of enum values ("open,replied"); empty items are ignored, repeats collapse. */
function csv<T extends readonly [string, ...string[]]>(values: T, label: string) {
  return z
    .string()
    .transform((s) => [...new Set(s.split(",").map((v) => v.trim()).filter(Boolean))])
    .pipe(z.array(z.enum(values, { error: `${label} must be one of: ${values.join(", ")}` })).max(values.length))
    .transform((v) => (v.length ? v : undefined));
}

const limitSchema = (max: number) =>
  z
    .string()
    .regex(/^\d{1,4}$/, `limit must be a whole number from 1 to ${max}`)
    .transform(Number)
    .pipe(z.number().int().min(1, `limit must be at least 1`).max(max, `limit must be at most ${max}`));

const baseShape = {
  q: z
    .string()
    .transform((s) => cleanLine(s).trim().slice(0, SEARCH_MAX_LENGTH))
    .transform((s) => s || undefined),
  status: csv(TICKET_STATUSES, "status"),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.string().regex(/^\d{1,10}$/, 'assignee must be "me", "unassigned" or a user id')]),
  category: csv(triageCategory.enumValues, "category"),
  urgency: csv(triageUrgency.enumValues, "urgency"),
  source: z.enum(ticketSource.enumValues, { error: `source must be one of: ${ticketSource.enumValues.join(", ")}` }),
  sort: z.enum(["newest", "oldest", "updated"], { error: "sort must be one of: newest, oldest, updated" }),
  cursor: z.string().max(300, "cursor is not valid"),
  overdue: z.literal("1", { error: 'overdue must be "1"' }).transform(() => true),
};

const listSchema = z.object({ ...baseShape, limit: limitSchema(MAX_PAGE_SIZE) }).partial();
const boardSchema = z
  .object({
    ...baseShape,
    limit: limitSchema(50),
    column: z.enum(TICKET_STATUSES, { error: `column must be one of: ${TICKET_STATUSES.join(", ")}` }),
  })
  .partial();
const summarySchema = z.object(baseShape).omit({ sort: true, cursor: true }).partial();

type Parsed<T> = { ok: true; data: T } | { ok: false; fields: Record<string, string> };

/** Field errors keyed by parameter name (an invalid item inside a comma list reports on the list). */
function queryFields(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(Object.entries(fieldErrors(error)).map(([k, v]) => [k.replace(/\.\d+$/, ""), v]));
}

/** First value of every non-empty query parameter (empty values count as absent). */
function firstValues(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params) if (v !== "" && !(k in out)) out[k] = v;
  return out;
}

function resolveAssignee(raw: string | undefined, userId: number): ListOptions["assignee"] {
  if (raw === undefined) return undefined;
  if (raw === "me") return userId;
  if (raw === "unassigned") return "unassigned";
  const id = Number(raw);
  // An id beyond int4 cannot exist: match nothing rather than overflow the database.
  return id > 0 && id <= 2_147_483_647 ? id : 0;
}

type Common = {
  q?: string;
  status?: string[];
  assignee?: string;
  category?: string[];
  urgency?: string[];
  source?: string;
  overdue?: boolean;
};

function filters(d: Common, userId: number) {
  return {
    q: d.q,
    status: d.status as ListOptions["status"],
    assignee: resolveAssignee(d.assignee, userId),
    category: d.category as ListOptions["category"],
    urgency: d.urgency as ListOptions["urgency"],
    source: d.source as ListOptions["source"],
    overdue: d.overdue,
  };
}

/** GET /api/tickets */
export function parseListQuery(params: URLSearchParams, userId: number): Parsed<ListOptions> {
  const r = listSchema.safeParse(firstValues(params));
  if (!r.success) return { ok: false, fields: queryFields(r.error) };
  const d = r.data;
  return { ok: true, data: { ...filters(d, userId), sort: d.sort, cursor: d.cursor, limit: d.limit ?? PAGE_SIZE } };
}

export type BoardQuery = Omit<ListOptions, "cursor"> & { column?: z.infer<typeof boardSchema>["column"]; cursor?: string };

/** GET /api/tickets/board: `column` + `cursor` load more of one column. */
export function parseBoardQuery(params: URLSearchParams, userId: number): Parsed<BoardQuery> {
  const r = boardSchema.safeParse(firstValues(params));
  if (!r.success) return { ok: false, fields: queryFields(r.error) };
  const d = r.data;
  if (d.cursor && !d.column) return { ok: false, fields: { column: "column is required with cursor" } };
  return {
    ok: true,
    data: { ...filters(d, userId), sort: d.sort, limit: d.limit ?? 10, column: d.column, cursor: d.cursor },
  };
}

/** GET /api/tickets/summary (status, sort, limit and cursor do not apply and are ignored). */
export function parseSummaryQuery(params: URLSearchParams, userId: number): Parsed<ListOptions> {
  const { status: _status, sort: _sort, limit: _limit, cursor: _cursor, column: _column, ...rest } = firstValues(params);
  const r = summarySchema.safeParse(rest);
  if (!r.success) return { ok: false, fields: queryFields(r.error) };
  return { ok: true, data: { ...filters(r.data, userId), status: undefined } };
}
