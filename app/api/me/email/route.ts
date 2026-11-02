import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requestEmailChange } from "@/lib/auth/account-tokens";
import { apiError, parseBody, route } from "@/lib/http";
import { emailField } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ newEmail: emailField(), password: z.string().min(1).max(200) }).strict();

/**
 * Starts an email change: 202 and a confirmation link to the new address. The old address stays
 * until it is confirmed. 400 `invalid_password`, 409 `email_taken`.
 */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const { newEmail, password } = await parseBody(req, bodySchema, { maxBytes: 4 * 1024 });
  if (newEmail === user.email) return apiError(400, "That is already your email address.", { code: "same_email" });
  const result = await requestEmailChange(user, newEmail, password);
  if (!result.ok) {
    return result.reason === "bad-password"
      ? apiError(400, "Your current password is not right.", { code: "invalid_password", fields: { password: "Your current password is not right." } })
      : apiError(409, "Another account already uses that address.", { code: "email_taken", fields: { newEmail: "Another account already uses that address." } });
  }
  return NextResponse.json({ ok: true, pendingEmail: newEmail }, { status: 202 });
});
