import { changeResponse, targetId, userNotFound, type UserRouteContext } from "@/lib/admin/http";
import { deactivateUser } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/auth";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin only: deactivates a user (never deletes), sets them Away and revokes their sessions. */
export const POST = route(async (req: Request, ctx: UserRouteContext) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const id = await targetId(ctx);
  if (id === null) return userNotFound();
  return changeResponse(await deactivateUser(admin.id, id));
});
