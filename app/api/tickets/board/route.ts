import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, route } from "@/lib/http";
import { boardTickets, InvalidCursorError } from "@/lib/tickets";
import { parseBoardQuery } from "@/lib/tickets/query";

export const dynamic = "force-dynamic";

/**
 * GET /api/tickets/board: tickets grouped by status, `{ columns: { open|replied|closed:
 * { count, tickets, nextCursor } } }`. Same filters as the list (q, status, assignee, category,
 * urgency, source, sort); `limit` is per column (1-50, default 10). To load more of one column
 * send `column=<status>&cursor=<that column's nextCursor>`: only that column is returned.
 */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const query = parseBoardQuery(new URL(req.url).searchParams, user.id);
  if (!query.ok) return apiError(400, "Invalid query parameters", { code: "validation_failed", fields: query.fields });
  const { column, cursor, ...rest } = query.data;
  try {
    return NextResponse.json(
      await boardTickets(column ? { ...rest, status: [column], cursors: cursor ? { [column]: cursor } : undefined } : rest),
    );
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return apiError(400, "Invalid cursor", { code: "invalid_cursor", fields: { cursor: "Invalid cursor" } });
    }
    throw err;
  }
});
