import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { setTicketStatus } from "@/lib/tickets";
import { parseTicketId } from "@/lib/tickets/schema";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";

export const dynamic = "force-dynamic";

/** Any signed-in agent or admin may close any ticket. */
export async function POST(req: Request, ctx: TicketRouteContext) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  const ticket = id === null ? null : await setTicketStatus(id, "closed");
  if (!ticket) return ticketNotFound();
  return NextResponse.json({ ticket });
}
