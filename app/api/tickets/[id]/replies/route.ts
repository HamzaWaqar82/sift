import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { IdempotencyConflictError, listReplies, replyInputSchema, sendReply, UnknownDraftError } from "@/lib/replies";
import { getTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";
import { parseTicketId } from "@/lib/tickets/schema";
import { fieldErrors } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** The ticket's sent replies, oldest first. */
export async function GET(req: Request, ctx: TicketRouteContext) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null || !(await getTicket(id))) return ticketNotFound();
  return NextResponse.json({ replies: await listReplies(id) });
}

/**
 * Sends (records) a reply. Any signed-in agent or admin may reply to any ticket.
 * Body: { body, idempotencyKey, draftTriageId: number | null } where draftTriageId is the triage
 * result whose draft the editor showed (400 if it is not a valid result of this ticket).
 * 201 on first send; 200 with the same reply on a repeat key.
 */
export async function POST(req: Request, ctx: TicketRouteContext) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();

  const json = await req.json().catch(() => null);
  const parsed = replyInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reply", fields: fieldErrors(parsed.error) }, { status: 400 });
  }

  try {
    const result = await sendReply(id, user.id, parsed.data);
    if (!result) return ticketNotFound();
    return NextResponse.json({ reply: result.reply }, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof UnknownDraftError) {
      return NextResponse.json({ error: err.message, fields: { draftTriageId: err.message } }, { status: 400 });
    }
    throw err;
  }
}
