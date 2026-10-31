import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, parseBody, route } from "@/lib/http";
import { IdempotencyConflictError, listReplies, replyInputSchema, sendReply, UnknownDraftError } from "@/lib/replies";
import { getTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";
import { parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/** The ticket's sent replies, oldest first. */
export const GET = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null || !(await getTicket(id))) return ticketNotFound();
  return NextResponse.json({ replies: await listReplies(id) });
});

/**
 * Sends (records) a reply. Any signed-in agent or admin may reply to any ticket.
 * Body: { body, idempotencyKey, draftTriageId: number | null } where draftTriageId is the triage
 * result whose draft the editor showed (400 if it is not a valid result of this ticket).
 * 201 on first send; 200 with the same reply on a repeat key.
 */
export const POST = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();

  const input = await parseBody(req, replyInputSchema, { message: "Invalid reply" });
  try {
    const result = await sendReply(id, user.id, input);
    if (!result) return ticketNotFound();
    return NextResponse.json({ reply: result.reply }, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return apiError(409, err.message, { code: "idempotency_conflict" });
    }
    if (err instanceof UnknownDraftError) {
      return apiError(400, err.message, { code: "unknown_draft", fields: { draftTriageId: err.message } });
    }
    throw err;
  }
});
