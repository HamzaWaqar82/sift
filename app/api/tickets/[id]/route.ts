import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTicket } from "@/lib/tickets";
import { parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/** One ticket with its assignee and latest triage. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  const ticket = id === null ? null : await getTicket(id);
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}
