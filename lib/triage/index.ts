// AI triage for one ticket: cache check, one provider call, strict re-validation, storage.
// Every attempt is stored in triage_results; the ticket's current triage is the latest row.
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { helpArticles, tickets, triageResults, type TriageCategory, type TriageUrgency } from "@/lib/db/schema";
import { aiDailyCap, triageModelName } from "./config";
import { takeDailySlot } from "./usage";
import { redactContactDetails } from "./redact";
import { runTriageModel, type TriageInput } from "./provider";
import { triageOutputSchema } from "./schema";

type TriageRow = typeof triageResults.$inferSelect;

/** What the API and UI see. A failed attempt never carries a draft. */
export type TriageView =
  | {
      status: "ok";
      id: number;
      category: TriageCategory;
      urgency: TriageUrgency;
      draft: string;
      article: { id: string; title: string } | null;
      model: string;
      createdAt: Date;
    }
  | { status: "error"; id: number; error: string; rawOutput: string | null; model: string; createdAt: Date };

export type TriageOutcome =
  | { kind: "not_found" }
  /** Today's AI call cap is used up; nothing was called or stored. */
  | { kind: "cap_reached"; cap: number }
  /** `cached`: a stored valid result was returned without calling the provider. */
  | { kind: "done"; triage: TriageView; cached: boolean };

async function latestRow(ticketId: number): Promise<TriageRow | null> {
  const [row] = await getDb()
    .select()
    .from(triageResults)
    .where(eq(triageResults.ticketId, ticketId))
    .orderBy(desc(triageResults.createdAt), desc(triageResults.id))
    .limit(1);
  return row ?? null;
}

async function toView(row: TriageRow): Promise<TriageView> {
  if (row.error !== null) {
    return { status: "error", id: row.id, error: row.error, rawOutput: row.rawOutput, model: row.model, createdAt: row.createdAt };
  }
  let article: { id: string; title: string } | null = null;
  if (row.articleId) {
    const [a] = await getDb()
      .select({ id: helpArticles.id, title: helpArticles.title })
      .from(helpArticles)
      .where(eq(helpArticles.id, row.articleId))
      .limit(1);
    article = a ?? null;
  }
  return {
    status: "ok",
    id: row.id,
    category: row.category!,
    urgency: row.urgency!,
    draft: row.draft!,
    article,
    model: row.model,
    createdAt: row.createdAt,
  };
}

/** The ticket's current triage (latest attempt, valid or failed), or null if never triaged. */
export async function getTriage(ticketId: number): Promise<TriageView | null> {
  const row = await latestRow(ticketId);
  return row ? toView(row) : null;
}

/**
 * The AI draft to prefill a reply with: the current triage's draft when it is valid, else null.
 * Ticket 07's reply editor reads this (also returned as `draft` by GET /api/tickets/:id/triage).
 */
export async function getLatestDraft(ticketId: number): Promise<string | null> {
  const row = await latestRow(ticketId);
  return row && row.error === null ? row.draft : null;
}

/** Turns the provider's raw text into a valid result or an error message. */
async function validate(rawText: string) {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false as const, error: "The AI returned output that is not valid JSON." };
  }
  const parsed = triageOutputSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false as const, error: `The AI result did not match the expected shape (${detail}).` };
  }
  const out = parsed.data;
  if (out.article_id !== null) {
    const [a] = await getDb()
      .select({ id: helpArticles.id })
      .from(helpArticles)
      .where(eq(helpArticles.id, out.article_id))
      .limit(1);
    if (!a) return { ok: false as const, error: `The AI cited a help article that does not exist ("${out.article_id}").` };
  }
  return { ok: true as const, value: out };
}

/**
 * Triage a ticket on demand. Returns the stored valid result without calling the provider
 * (cache) unless `force` is set; otherwise makes exactly one provider call and stores the
 * outcome. A failed attempt is stored as an error with the raw output and can be retried.
 *
 * `force` is admin regenerate (the route enforces the role). Before the provider call the daily
 * cap is checked (`cap_reached`, nothing called or stored) and customer emails and phone numbers
 * are redacted from the text sent.
 */
export async function requestTriage(
  ticketId: number,
  opts: { requestedBy: number; force?: boolean },
): Promise<TriageOutcome> {
  const db = getDb();
  const [ticket] = await db
    .select({ subject: tickets.subject, body: tickets.body })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) return { kind: "not_found" };

  if (!opts.force) {
    const current = await latestRow(ticketId);
    if (current && current.error === null) return { kind: "done", triage: await toView(current), cached: true };
  }

  if (!(await takeDailySlot())) return { kind: "cap_reached", cap: aiDailyCap() };

  const articles = await db
    .select({ id: helpArticles.id, title: helpArticles.title, body: helpArticles.body })
    .from(helpArticles)
    .orderBy(helpArticles.id);
  // Customer emails and phone numbers never reach the provider; the stored ticket is unchanged.
  const input: TriageInput = {
    subject: redactContactDetails(ticket.subject),
    body: redactContactDetails(ticket.body),
    articles,
  };

  let record: typeof triageResults.$inferInsert;
  const base = { ticketId, requestedBy: opts.requestedBy };
  try {
    const { rawText, model } = await runTriageModel(input);
    const result = await validate(rawText);
    record = result.ok
      ? {
          ...base,
          model,
          category: result.value.category,
          urgency: result.value.urgency,
          draft: result.value.draft,
          articleId: result.value.article_id,
        }
      : { ...base, model, error: result.error, rawOutput: rawText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record = { ...base, model: triageModelName(), error: `The AI provider request failed: ${message}`.slice(0, 1000) };
  }

  const [row] = await db.insert(triageResults).values(record).returning();
  return { kind: "done", triage: await toView(row), cached: false };
}
