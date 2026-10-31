// Shared bits for the /api/tickets/:id/* route handlers.
import { apiError } from "@/lib/http";

/** The second argument Next passes to every /api/tickets/[id]/* handler. */
export type TicketRouteContext = { params: Promise<{ id: string }> };

/** The 404 every ticket route returns for a missing or malformed ticket id. */
export function ticketNotFound() {
  return apiError(404, "Ticket not found", { code: "not_found" });
}
