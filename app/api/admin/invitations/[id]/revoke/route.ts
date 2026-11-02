import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { apiError, parseIntId, route } from "@/lib/http";
import { revokeInvite } from "@/lib/invitations";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Admin only: revokes a pending invitation so its link no longer works. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const id = parseIntId((await ctx.params).id);
  const invitation = id === null ? null : await revokeInvite(admin, id);
  if (!invitation) return apiError(404, "Invitation not found, or it can no longer be changed", { code: "not_found" });
  return NextResponse.json({ invitation });
});
