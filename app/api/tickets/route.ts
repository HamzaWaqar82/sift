import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, parseBody, route } from "@/lib/http";
import { createTicket, InvalidCursorError, listTickets } from "@/lib/tickets";
import { parseListQuery } from "@/lib/tickets/query";
import { ticketFormSchema } from "@/lib/tickets/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/tickets: one page of tickets plus `nextCursor`. Query: q, status (csv), assignee
 * (me | unassigned | user id), category (csv), urgency (csv), source, sort (newest | oldest |
 * updated), limit (1-100, default 20), cursor. 400 `validation_failed` with `fields` on bad values.
 */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const query = parseListQuery(new URL(req.url).searchParams, user.id);
  if (!query.ok) return apiError(400, "Invalid query parameters", { code: "validation_failed", fields: query.fields });
  try {
    return NextResponse.json(await listTickets(query.data));
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return apiError(400, "Invalid cursor", { code: "invalid_cursor", fields: { cursor: "Invalid cursor" } });
    }
    throw err;
  }
});

/** Creates a ticket from the agent form. 400 with `fields` on invalid input. */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const input = await parseBody(req, ticketFormSchema);
  const { ticket } = await createTicket({ ...input, source: "form" });
  return NextResponse.json({ ticket }, { status: 201 });
});
