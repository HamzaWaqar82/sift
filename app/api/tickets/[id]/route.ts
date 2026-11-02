import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { getTicket } from "@/lib/tickets";
import { parseTicketId } from "@/lib/tickets/schema";
import { markOpened } from "@/lib/tickets/sweeps";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";

export const dynamic = "force-dynamic";

/** One ticket with its assignee and latest triage. */
export const GET = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  const ticket = id === null ? null : await getTicket(id);
  if (!ticket) return ticketNotFound();
  if (ticket.assigneeId === user.id) await markOpened(ticket.id, user.id);
  return NextResponse.json({ ticket });
});
