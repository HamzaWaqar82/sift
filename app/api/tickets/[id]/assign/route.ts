import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { apiError, parseBody, route } from "@/lib/http";
import { assignTicket } from "@/lib/tickets";
import { parseTicketId } from "@/lib/tickets/schema";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";
import { idField } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ assigneeId: idField.nullable() }).strict();

/**
 * Admin only: assign, reassign or unassign (assigneeId: null) a ticket.
 * Agents get 403 even when calling the API directly, and nothing changes.
 */
export const POST = route(async (req: Request, ctx: TicketRouteContext) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();

  const { assigneeId } = await parseBody(req, bodySchema, { message: "Body must be { assigneeId: number | null }" });
  const result = await assignTicket(id, assigneeId, admin.id);
  if (!result.ok) {
    return result.reason === "ticket-not-found"
      ? ticketNotFound()
      : apiError(400, "Unknown user", { code: "unknown_user", fields: { assigneeId: "Unknown user" } });
  }
  return NextResponse.json({ ticket: result.ticket });
});
