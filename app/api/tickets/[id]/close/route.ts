import { NextResponse } from "next/server";
import { isAdmin, requireUser } from "@/lib/auth";
import { apiError, route } from "@/lib/http";
import { closeTicket, getTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";
import { denied, ticketPermission } from "@/lib/tickets/permissions";
import { parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/**
 * Close rule: an admin may close any ticket; an agent only a ticket they own (403
 * `not_ticket_owner`, 409 `ticket_unassigned`) that has at least one sent reply (409
 * `reply_required` otherwise). Closing a closed ticket is a no-op 200.
 */
export const POST = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  const ticket = id === null ? null : await getTicket(id);
  if (!ticket) return ticketNotFound();
  // Closing a closed ticket stays a no-op for anyone.
  const denial = ticket.status === "closed" ? null : ticketPermission(user, "close", ticket);
  if (denial) return denied(denial);
  const result = await closeTicket(ticket.id, { anyTicket: isAdmin(user) });
  if (!result.ok) {
    return result.reason === "not-found"
      ? ticketNotFound()
      : apiError(409, "Send a reply before closing this ticket. Only an admin can close a ticket without one.", {
          code: "reply_required",
        });
  }
  return NextResponse.json({ ticket: result.ticket });
});
