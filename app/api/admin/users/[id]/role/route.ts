import { z } from "zod";
import { changeResponse, targetId, userNotFound, type UserRouteContext } from "@/lib/admin/http";
import { changeRole } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/auth";
import { parseBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ role: z.enum(["agent", "admin"], { error: "Role must be agent or admin" }) }).strict();

/** Admin only: change a user's role. Revokes that user's sessions. */
export const POST = route(async (req: Request, ctx: UserRouteContext) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const id = await targetId(ctx);
  if (id === null) return userNotFound();
  const { role } = await parseBody(req, bodySchema, { message: 'Body must be { role: "agent" | "admin" }' });
  return changeResponse(await changeRole(admin.id, id, role));
});
