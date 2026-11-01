import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, requireUser } from "@/lib/auth";
import { apiError, parseBody, route } from "@/lib/http";
import { getLatestAttempt, getTriageState, requestTriage } from "@/lib/triage";
import { parseTicketId } from "@/lib/tickets/schema";
import { getTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";

export const dynamic = "force-dynamic";

/**
 * `state`: the ticket's triage state `{state, retryAt}` (none, queued, running, done,
 * waiting_rate_limit, daily_cap_reached, failed or superseded).
 * `triage`: the latest attempt (valid or failed), for the triage panel.
 * `draft` / `draftTriageId`: the current (latest VALID) triage's draft and id, to prefill a reply
 * with; both null when there is no valid triage. Send `draftTriageId` back with the reply.
 */
export const GET = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  const ticket = id === null ? null : await getTicket(id);
  if (!ticket) return ticketNotFound();
  const current = ticket.currentTriage;
  return NextResponse.json({
    state: await getTriageState(ticket.id),
    triage: await getLatestAttempt(ticket.id),
    draft: current?.draft ?? null,
    draftTriageId: current?.id ?? null,
  });
});

/** Optional JSON body. `{"force": true}` = regenerate (admin only). An empty body means `{}`. */
const triageRequestSchema = z.object({ force: z.boolean().optional() }).strict();

/**
 * Request triage. Any signed-in user. 200 with the current valid result (`cached: true`, no
 * provider call) when it is up to date. Otherwise 202 with `state`: a high-priority
 * `triage.manual` job does the work and the outcome arrives as a `triage.updated` event (or on
 * the next GET). Retrying a failed or out-of-date triage works the same way.
 * `{"force": true}` regenerates even over a valid result: admin only (403 for agents).
 */
export const POST = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const parsed = await parseBody(req, triageRequestSchema, {
    allowEmpty: true,
    maxBytes: 1024,
    message: 'Body must be empty or {"force": true}.',
  });
  const force = parsed.force === true;
  if (force && !isAdmin(user)) {
    return apiError(403, "Only an admin can regenerate a triage.", { code: "forbidden" });
  }

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();
  const outcome = await requestTriage(id, { requestedBy: user.id, force });
  if (outcome.kind === "not_found") return ticketNotFound();
  if (outcome.kind === "queued") return NextResponse.json({ state: outcome.state, cached: false }, { status: 202 });

  const { triage, state } = outcome;
  return NextResponse.json({
    state,
    triage,
    draft: triage.status === "ok" ? triage.draft : null,
    draftTriageId: triage.id,
    cached: true,
  });
});
