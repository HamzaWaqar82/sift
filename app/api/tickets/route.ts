import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createTicket, InvalidCursorError, listTickets } from "@/lib/tickets";
import { fieldErrors, listQuerySchema, ticketFormSchema } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/** GET /api/tickets?status=open&cursor=... : one page (20) newest first, plus nextCursor. */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const params = new URL(req.url).searchParams;
  const query = listQuerySchema.safeParse({
    status: params.get("status") || undefined,
    cursor: params.get("cursor") || undefined,
  });
  if (!query.success) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }
  try {
    return NextResponse.json(await listTickets(query.data));
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    throw err;
  }
}

/** Creates a ticket from the agent form. 400 with `fields` on invalid input. */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const json = await req.json().catch(() => null);
  const parsed = ticketFormSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please fix the highlighted fields", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { ticket } = await createTicket({ ...parsed.data, source: "form" });
  return NextResponse.json({ ticket }, { status: 201 });
}
