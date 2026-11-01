import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseBody, route } from "@/lib/http";
import { addNote, listNotes, noteInputSchema } from "@/lib/notes";
import { getTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";
import { parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/** The ticket's internal notes, oldest first. Staff only. */
export const GET = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null || !(await getTicket(id))) return ticketNotFound();
  return NextResponse.json({ notes: await listNotes(id) });
});

/** Adds an internal note. Any signed-in agent or admin may note any ticket. Body: { body }. 201. */
export const POST = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();

  const input = await parseBody(req, noteInputSchema, { message: "Invalid note" });
  const note = await addNote(id, user.id, input.body);
  if (!note) return ticketNotFound();
  return NextResponse.json({ note }, { status: 201 });
});
