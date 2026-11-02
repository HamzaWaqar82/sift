import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { blockedFor, inviteSendLimit, recordHit } from "@/lib/auth/rate-limit";
import { apiError, parseIntId, rateLimited, route } from "@/lib/http";
import { resendInvite } from "@/lib/invitations";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Admin only: sends a fresh link (the old one stops working) and restarts the 7 days. Counts toward the daily send limit. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const id = parseIntId((await ctx.params).id);
  const notFound = () => apiError(404, "Invitation not found, or it can no longer be changed", { code: "not_found" });
  if (id === null) return notFound();

  const keys = [`invite-send:admin:${admin.id}`];
  const wait = await blockedFor(keys, inviteSendLimit());
  if (wait > 0) return rateLimited("You have sent the most invitations allowed today. Try again later.", wait);
  const invitation = await resendInvite(admin, id);
  if (!invitation) return notFound();
  await recordHit(keys, inviteSendLimit());
  return NextResponse.json({ invitation });
});
