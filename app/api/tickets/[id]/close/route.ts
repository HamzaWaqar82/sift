import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { setTicketStatus } from "@/lib/tickets";
import { parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/** Any signed-in agent or admin may close any ticket. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  const ticket = id === null ? null : await setTicketStatus(id, "closed");
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}
