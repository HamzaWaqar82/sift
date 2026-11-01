import { changeResponse, targetId, userNotFound, type UserRouteContext } from "@/lib/admin/http";
import { reactivateUser } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/auth";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin only: lets a deactivated user sign in again. */
export const POST = route(async (req: Request, ctx: UserRouteContext) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const id = await targetId(ctx);
  if (id === null) return userNotFound();
  return changeResponse(await reactivateUser(admin.id, id));
});
