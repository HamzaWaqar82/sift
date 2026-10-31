import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getLatestDraft, getTriage, requestTriage } from "@/lib/triage";
import { parseTicketId } from "@/lib/tickets/schema";
import { getTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "Ticket not found" }, { status: 404 });

/** Current triage (latest attempt) and the valid draft to prefill a reply with (`draft`, or null). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null || !(await getTicket(id))) return notFound();
  const [triage, draft] = await Promise.all([getTriage(id), getLatestDraft(id)]);
  return NextResponse.json({ triage, draft });
}

/** Optional JSON body. `{"force": true}` = regenerate (admin only). An empty body means `{}`. */
const triageRequestSchema = z.object({ force: z.boolean().optional() }).strict();

/**
 * Request triage. Any signed-in user. Returns the cached valid result (no provider call) when
 * there is one; otherwise one provider call (agents can retry after a failure this way).
 * `{"force": true}` regenerates even over a valid result: admin only (403 for agents).
 * 200 for a valid result, 502 when the provider failed or its output was rejected (body still
 * has the stored error triage), 429 when today's AI_DAILY_CAP is used up (nothing called).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const text = await req.text();
  let raw: unknown = {};
  try {
    if (text.trim()) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const parsed = triageRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body must be empty or {"force": true}.' }, { status: 400 });
  }
  const force = parsed.data.force === true;
  if (force && user.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can regenerate a triage." }, { status: 403 });
  }

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return notFound();
  const outcome = await requestTriage(id, { requestedBy: user.id, force });
  if (outcome.kind === "not_found") return notFound();
  if (outcome.kind === "cap_reached") {
    return NextResponse.json(
      {
        error: `The daily AI limit (${outcome.cap} triage calls) has been reached. Write the reply manually; AI triage is available again tomorrow (UTC).`,
        code: "ai_daily_cap_reached",
      },
      { status: 429 },
    );
  }

  const { triage, cached } = outcome;
  const draft = triage.status === "ok" ? triage.draft : null;
  return NextResponse.json({ triage, draft, cached }, { status: triage.status === "ok" ? 200 : 502 });
}
