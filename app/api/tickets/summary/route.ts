import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, route } from "@/lib/http";
import { ticketSummary } from "@/lib/tickets";
import { parseSummaryQuery } from "@/lib/tickets/query";

export const dynamic = "force-dynamic";

/**
 * GET /api/tickets/summary: `{ total, byStatus: { open, replied, closed } }` for the tickets
 * matching q, assignee, category, urgency and source. `status` is ignored (every status is counted).
 */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const query = parseSummaryQuery(new URL(req.url).searchParams, user.id);
  if (!query.ok) return apiError(400, "Invalid query parameters", { code: "validation_failed", fields: query.fields });
  return NextResponse.json(await ticketSummary(query.data));
});
