import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, parseBody, route } from "@/lib/http";
import {
  IdempotencyConflictError,
  listReplies,
  replyInputSchema,
  sendReply,
  StaleTicketError,
  SuppressedRecipientError,
  UnknownDraftError,
} from "@/lib/replies";
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
 * Queues a reply for sending. Any signed-in agent or admin may reply to any ticket.
 * Body: { body, idempotencyKey, draftTriageId: number | null, latestMessageId?: number | null }
 * where draftTriageId is the triage result whose draft the editor showed (400 if it is not a
 * valid result of this ticket) and latestMessageId the newest message it showed (409
 * `stale_ticket` if a newer one exists). 422 `recipient_suppressed` for a suppressed address.
 * 201 { reply, message: { id, status: "queued" } } on first send; 200 with the same on a repeat key.
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
    return NextResponse.json({ reply: result.reply, message: result.message }, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return apiError(409, err.message, { code: "idempotency_conflict" });
    }
    if (err instanceof StaleTicketError) return apiError(409, err.message, { code: "stale_ticket" });
    if (err instanceof SuppressedRecipientError) return apiError(422, err.message, { code: "recipient_suppressed" });
    if (err instanceof UnknownDraftError) {
      return apiError(400, err.message, { code: "unknown_draft", fields: { draftTriageId: err.message } });
    }
    throw err;
  }
});
