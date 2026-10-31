// Saved ticket views: per-user named snapshots of the list state (view type, filters, sort,
// page size). Private to their owner; every query is scoped by user id.
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { savedViews } from "@/lib/db/schema";
import { parseListQuery } from "@/lib/tickets/query";
import { lineField } from "@/lib/validation";

export const MAX_SAVED_VIEWS = 20;
export const VIEW_NAME_MAX = 40;

export type SavedView = { id: number; name: string; params: Record<string, string>; createdAt: Date; updatedAt: Date };

const PARAM_KEYS = ["view", "q", "status", "assignee", "category", "urgency", "source", "sort", "limit"] as const;

/**
 * The list state a view stores. Filter values are checked by the same parser as GET /api/tickets,
 * so a saved view can never hold a query the list would reject. Defaults are dropped.
 */
export const viewParamsSchema = z
  .object(Object.fromEntries(PARAM_KEYS.map((k) => [k, z.string().max(300).optional()])) as Record<(typeof PARAM_KEYS)[number], z.ZodOptional<z.ZodString>>)
  .strict()
  .superRefine((p, ctx) => {
    if (p.view !== undefined && !["inbox", "table", "board"].includes(p.view)) {
      ctx.addIssue({ code: "custom", path: ["view"], message: "view must be one of: inbox, table, board" });
    }
    if (p.limit !== undefined && !["20", "50", "100"].includes(p.limit)) {
      ctx.addIssue({ code: "custom", path: ["limit"], message: "limit must be one of: 20, 50, 100" });
    }
    const list = new URLSearchParams();
    for (const k of ["q", "status", "assignee", "category", "urgency", "source", "sort"] as const) if (p[k]) list.set(k, p[k]!);
    const parsed = parseListQuery(list, 1);
    if (!parsed.ok) for (const [k, message] of Object.entries(parsed.fields)) ctx.addIssue({ code: "custom", path: [k], message });
  })
  .transform((p) => {
    const out: Record<string, string> = {};
    for (const k of PARAM_KEYS) {
      const v = p[k]?.trim();
      if (!v) continue;
      if ((k === "view" && v === "inbox") || (k === "sort" && v === "newest") || (k === "limit" && v === "20")) continue;
      out[k] = v;
    }
    return out;
  });

const nameField = lineField("Name", VIEW_NAME_MAX);

export const createViewSchema = z.object({ name: nameField, params: viewParamsSchema }).strict();
export const updateViewSchema = z.object({ name: nameField }).strict();

const columns = {
  id: savedViews.id,
  name: savedViews.name,
  params: savedViews.params,
  createdAt: savedViews.createdAt,
  updatedAt: savedViews.updatedAt,
};

/** The user's saved views, oldest first (the order they appear as tabs). */
export async function listViews(userId: number): Promise<SavedView[]> {
  return getDb().select(columns).from(savedViews).where(eq(savedViews.userId, userId)).orderBy(asc(savedViews.createdAt), asc(savedViews.id));
}

async function nameTaken(userId: number, name: string, exceptId?: number): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: savedViews.id })
    .from(savedViews)
    .where(
      and(
        eq(savedViews.userId, userId),
        sql`lower(${savedViews.name}) = lower(${name})`,
        exceptId === undefined ? undefined : ne(savedViews.id, exceptId),
      ),
    )
    .limit(1);
  return !!row;
}

export type CreateResult = { ok: true; view: SavedView } | { ok: false; reason: "limit" | "name_taken" };

/** Saves a view for this user. Names are unique per user (case-insensitive); at most MAX_SAVED_VIEWS. */
export async function createView(userId: number, input: z.infer<typeof createViewSchema>): Promise<CreateResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Serialise this user's creates so the count check and the insert cannot interleave.
    await tx.execute(sql`select pg_advisory_xact_lock(${userId})`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(savedViews).where(eq(savedViews.userId, userId));
    if (n >= MAX_SAVED_VIEWS) return { ok: false, reason: "limit" };
    if (await nameTaken(userId, input.name)) return { ok: false, reason: "name_taken" };
    const [view] = await tx.insert(savedViews).values({ userId, name: input.name, params: input.params }).returning(columns);
    return { ok: true, view };
  });
}

/** Renames one of the user's views. null: no such view for this user. */
export async function renameView(userId: number, id: number, name: string): Promise<SavedView | null | "name_taken"> {
  if (await nameTaken(userId, name, id)) {
    const [own] = await getDb().select({ id: savedViews.id }).from(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, userId)));
    return own ? "name_taken" : null;
  }
  const [view] = await getDb()
    .update(savedViews)
    .set({ name, updatedAt: sql`now()` })
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, userId)))
    .returning(columns);
  return view ?? null;
}

/** Deletes one of the user's views. false: no such view for this user. */
export async function deleteView(userId: number, id: number): Promise<boolean> {
  const rows = await getDb()
    .delete(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, userId)))
    .returning({ id: savedViews.id });
  return rows.length > 0;
}
