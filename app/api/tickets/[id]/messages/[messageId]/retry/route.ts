import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, parseIntId, route } from "@/lib/http";
import { retryMessage } from "@/lib/replies/delivery";
import { getTicket } from "@/lib/tickets";
import { ticketNotFound } from "@/lib/tickets/http";
import { denied, ticketPermission } from "@/lib/tickets/permissions";
import { parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; messageId: string }> };

/**
 * Manually retries a failed reply: the ticket's owner or an admin. It goes back to queued with
 * a fresh set of attempts. 200 { message: { id, status: "queued" } }; 409 `not_failed` unless
 * the reply is failed; 404 for an unknown ticket or message.
 */
export const POST = route(async (req: Request, ctx: Context) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const params = await ctx.params;
  const id = parseTicketId(params.id);
  const ticket = id === null ? null : await getTicket(id);
  if (!ticket) return ticketNotFound();
  const denial = ticketPermission(user, "retry_send", ticket);
  if (denial) return denied(denial);

  const messageId = parseIntId(params.messageId);
  const result = messageId === null ? "not_found" : await retryMessage(ticket.id, messageId);
  if (result === "not_found") return apiError(404, "Reply not found", { code: "not_found" });
  if (result === "not_failed") return apiError(409, "Only a failed reply can be retried.", { code: "not_failed" });
  return NextResponse.json({ message: result });
});
