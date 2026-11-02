import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { blockedFor, inviteSendLimit, recordHit } from "@/lib/auth/rate-limit";
import { apiError, parseBody, rateLimited, route } from "@/lib/http";
import { createInvite, listInvites } from "@/lib/invitations";
import { emailField } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: emailField(), role: z.enum(["agent", "admin"], { error: "Role must be agent or admin" }) }).strict();

/** Admin only: every invitation, newest first, with its status. */
export const GET = route(async (req: Request) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  return NextResponse.json({ invitations: await listInvites() });
});

/** Admin only: invites an address with a role and queues the email. 201 `{invitation}`; 20 per day per admin. */
export const POST = route(async (req: Request) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const { email, role } = await parseBody(req, bodySchema, { message: "Body must be { email, role }" });

  const keys = [`invite-send:admin:${admin.id}`];
  const wait = await blockedFor(keys, inviteSendLimit());
  if (wait > 0) return rateLimited("You have sent the most invitations allowed today. Try again later.", wait);

  const result = await createInvite(admin, email, role);
  if (!result.ok) {
    return result.reason === "has-account"
      ? apiError(409, "That address already has an account", { code: "has_account" })
      : apiError(409, "That address already has a pending invitation. Resend it instead.", { code: "already_pending" });
  }
  await recordHit(keys, inviteSendLimit());
  return NextResponse.json({ invitation: result.invite }, { status: 201 });
});
