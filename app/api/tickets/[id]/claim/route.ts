import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { claimTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";
import { parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/**
 * Claim an unowned ticket: any signed-in agent or admin. Atomic, so two people never own the
 * same ticket; the loser gets 409 `already_claimed` with the winner in `owner`.
 */
export const POST = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();
  const result = await claimTicket(id, user.id);
  if (result.ok) return NextResponse.json({ ticket: result.ticket });
  if (result.reason === "not-found") return ticketNotFound();
  return NextResponse.json(
    { error: `${result.owner.name} claimed this ticket first.`, code: "already_claimed", owner: result.owner },
    { status: 409 },
  );
});
