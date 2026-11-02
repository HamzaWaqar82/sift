import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmEmailChange, EMAIL_CHANGE_INVALID_MESSAGE } from "@/lib/auth/account-tokens";
import { clearSessionCookie } from "@/lib/auth/session";
import { apiError, parseBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ token: z.string().min(1).max(200) }).strict();

/**
 * Public (the token is the credential, and the link may open in a signed-out browser): applies the
 * new address and signs the user out everywhere. 200, or 410 for any link that does not work.
 */
export const POST = route(async (req: Request) => {
  const { token } = await parseBody(req, bodySchema, { maxBytes: 4 * 1024 });
  if (!(await confirmEmailChange(token))) return apiError(410, EMAIL_CHANGE_INVALID_MESSAGE, { code: "email_change_invalid" });
  const res = NextResponse.json({ ok: true });
  await clearSessionCookie(res);
  return res;
});
