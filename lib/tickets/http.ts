// Shared bits for the /api/tickets/:id/* route handlers.
import { NextResponse } from "next/server";

/** The second argument Next passes to every /api/tickets/[id]/* handler. */
export type TicketRouteContext = { params: Promise<{ id: string }> };

/** The 404 every ticket route returns for a missing or malformed ticket id. */
export function ticketNotFound() {
  return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
}
