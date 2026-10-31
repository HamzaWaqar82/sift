import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError, parseBody, parseIntId, route } from "@/lib/http";
import { deleteView, renameView, updateViewSchema } from "@/lib/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Another user's view is reported exactly like a missing one. */
const viewNotFound = () => apiError(404, "View not found", { code: "not_found" });

/** PATCH { name } -> { view }: rename one of your views. */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const id = parseIntId((await ctx.params).id);
  if (id === null) return viewNotFound();
  const { name } = await parseBody(req, updateViewSchema, { maxBytes: 2 * 1024, message: "Body must be { name: string }" });
  const result = await renameView(user.id, id, name);
  if (result === null) return viewNotFound();
  if (result === "name_taken") {
    return apiError(409, "You already have a view with that name", { code: "name_taken", fields: { name: "You already have a view with that name" } });
  }
  return NextResponse.json({ view: result });
});

/** DELETE -> { ok: true }: delete one of your views. */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const id = parseIntId((await ctx.params).id);
  if (id === null || !(await deleteView(user.id, id))) return viewNotFound();
  return NextResponse.json({ ok: true });
});
