import { NextResponse } from "next/server";
import { z } from "zod";
import { completePasswordReset, RESET_INVALID_MESSAGE } from "@/lib/auth/account-tokens";
import { blockedFor, clientAddress, recordHit, RESET_IP_LIMIT } from "@/lib/auth/rate-limit";
import { apiError, parseBody, rateLimited, route } from "@/lib/http";
import { passwordField } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ token: z.string().min(1).max(200), password: passwordField() }).strict();

/**
 * Public (the token is the credential): sets the new password and signs the user out everywhere.
 * 200, or 410 for any link that does not work. 10 attempts per hour per IP.
 */
export const POST = route(async (req: Request) => {
  const keys = [`reset:ip:${clientAddress(req)}`];
  const wait = await blockedFor(keys, RESET_IP_LIMIT);
  if (wait > 0) return rateLimited("Too many attempts. Try again later.", wait);
  await recordHit(keys, RESET_IP_LIMIT);

  const { token, password } = await parseBody(req, bodySchema, { maxBytes: 4 * 1024 });
  if (!(await completePasswordReset(token, password))) return apiError(410, RESET_INVALID_MESSAGE, { code: "reset_invalid" });
  return NextResponse.json({ ok: true });
});
