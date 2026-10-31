import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { IdempotencyConflictError, listReplies, replyInputSchema, sendReply } from "@/lib/replies";
import { getTicket } from "@/lib/tickets";
import { fieldErrors, parseTicketId } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The ticket's sent replies, oldest first. */
export async function GET(req: Request, ctx: Ctx) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null || !(await getTicket(id))) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  return NextResponse.json({ replies: await listReplies(id) });
}

/**
 * Sends (records) a reply. Any signed-in agent or admin may reply to any ticket.
 * Body: { body, idempotencyKey }. 201 on first send; 200 with the same reply on a repeat key.
 */
export async function POST(req: Request, ctx: Ctx) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const json = await req.json().catch(() => null);
  const parsed = replyInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reply", fields: fieldErrors(parsed.error) }, { status: 400 });
  }

  try {
    const result = await sendReply(id, user.id, parsed.data);
    if (!result) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    return NextResponse.json({ reply: result.reply }, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
