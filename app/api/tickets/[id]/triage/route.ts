import { NextResponse } from "next/server";
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

/**
 * Request triage. Any signed-in user. Returns the cached valid result (no provider call) when
 * there is one; otherwise one provider call. 200 for a valid result, 502 when the provider
 * failed or its output was rejected (body still has the stored error triage).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return notFound();
  const outcome = await requestTriage(id, { requestedBy: user.id });
  if (outcome.kind === "not_found") return notFound();

  const { triage, cached } = outcome;
  const draft = triage.status === "ok" ? triage.draft : null;
  return NextResponse.json({ triage, draft, cached }, { status: triage.status === "ok" ? 200 : 502 });
}
