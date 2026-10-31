import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, parseBody, route } from "@/lib/http";
import { createView, createViewSchema, listViews, MAX_SAVED_VIEWS } from "@/lib/views";

export const dynamic = "force-dynamic";

/** GET -> { views }: the signed-in user's saved views (nobody else's). */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  return NextResponse.json({ views: await listViews(user.id) });
});

/**
 * POST { name, params } -> 201 { view }. `params` is the list state (view, q, status, assignee,
 * category, urgency, source, sort, limit), validated like GET /api/tickets.
 * 409 name_taken (same name, any case) or view_limit (MAX_SAVED_VIEWS per user).
 */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const input = await parseBody(req, createViewSchema, { maxBytes: 8 * 1024, message: "Check the view's name and filters" });
  const result = await createView(user.id, input);
  if (!result.ok) {
    return result.reason === "limit"
      ? apiError(409, `You can save up to ${MAX_SAVED_VIEWS} views. Delete one to save another.`, { code: "view_limit" })
      : apiError(409, "You already have a view with that name", { code: "name_taken", fields: { name: "You already have a view with that name" } });
  }
  return NextResponse.json({ view: result.view }, { status: 201 });
});
