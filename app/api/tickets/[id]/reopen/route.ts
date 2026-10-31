import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, route } from "@/lib/http";
import { reopenTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";
import { parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/** Any signed-in agent or admin may reopen a closed ticket (closed -> open); 409 `not_closed` otherwise. */
export const POST = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();
  const result = await reopenTicket(id);
  if (!result.ok) {
    return result.reason === "not-found"
      ? ticketNotFound()
      : apiError(409, "Only a closed ticket can be reopened.", { code: "not_closed" });
  }
  return NextResponse.json({ ticket: result.ticket });
});
