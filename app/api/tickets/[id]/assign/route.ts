import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assignTicket } from "@/lib/tickets";
import { parseTicketId } from "@/lib/tickets/schema";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ assigneeId: z.number().int().positive().nullable() });

/**
 * Admin only: assign, reassign or unassign (assigneeId: null) a ticket.
 * Agents get 403 even when calling the API directly, and nothing changes.
 */
export async function POST(req: Request, ctx: TicketRouteContext) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Body must be { assigneeId: number | null }" }, { status: 400 });
  }

  const result = await assignTicket(id, parsed.data.assigneeId);
  if (!result.ok) {
    return result.reason === "ticket-not-found"
      ? ticketNotFound()
      : NextResponse.json({ error: "Unknown user" }, { status: 400 });
  }
  return NextResponse.json({ ticket: result.ticket });
}
