import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, requireUser } from "@/lib/auth";
import { getLatestAttempt, requestTriage } from "@/lib/triage";
import { parseTicketId } from "@/lib/tickets/schema";
import { getTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";

export const dynamic = "force-dynamic";

/**
 * `triage`: the latest attempt (valid or failed), for the triage panel.
 * `draft` / `draftTriageId`: the current (latest VALID) triage's draft and id, to prefill a reply
 * with; both null when there is no valid triage. Send `draftTriageId` back with the reply.
 */
export async function GET(req: Request, ctx: TicketRouteContext) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  const ticket = id === null ? null : await getTicket(id);
  if (!ticket) return ticketNotFound();
  const current = ticket.currentTriage;
  return NextResponse.json({
    triage: await getLatestAttempt(ticket.id),
    draft: current?.draft ?? null,
    draftTriageId: current?.id ?? null,
  });
}

/** Optional JSON body. `{"force": true}` = regenerate (admin only). An empty body means `{}`. */
const triageRequestSchema = z.object({ force: z.boolean().optional() }).strict();

/**
 * Request triage. Any signed-in user. Returns the current valid result (no provider call) when
 * there is one; otherwise one provider call (agents can retry after a failure this way).
 * `{"force": true}` regenerates even over a valid result: admin only (403 for agents).
 * 200 for a valid result, 502 when the provider failed or its output was rejected (body still
 * has the stored error triage), 429 when today's AI_DAILY_CAP is used up (nothing called).
 */
export async function POST(req: Request, ctx: TicketRouteContext) {
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
  if (force && !isAdmin(user)) {
    return NextResponse.json({ error: "Only an admin can regenerate a triage." }, { status: 403 });
  }

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();
  const outcome = await requestTriage(id, { requestedBy: user.id, force });
  if (outcome.kind === "not_found") return ticketNotFound();
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
  const ok = triage.status === "ok";
  return NextResponse.json(
    { triage, draft: ok ? triage.draft : null, draftTriageId: ok ? triage.id : null, cached },
    { status: ok ? 200 : 502 },
  );
}
