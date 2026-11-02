import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset } from "@/lib/auth/account-tokens";
import { blockedFor, clientAddress, recordHit, RESET_EMAIL_LIMIT, RESET_IP_LIMIT } from "@/lib/auth/rate-limit";
import { parseBody, rateLimited, route } from "@/lib/http";
import { emailField } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: emailField() }).strict();

/**
 * Public. Emails a reset link when the address belongs to an active user, and answers the same
 * 200 for every address. Limited to 3 per hour per email and 10 per hour per IP (429 + Retry-After).
 */
export const POST = route(async (req: Request) => {
  const { email } = await parseBody(req, bodySchema, { maxBytes: 4 * 1024 });
  const ipKey = [`reset:ip:${clientAddress(req)}`];
  const emailKey = [`reset-request:email:${email}`];
  const wait = Math.max(await blockedFor(ipKey, RESET_IP_LIMIT), await blockedFor(emailKey, RESET_EMAIL_LIMIT));
  if (wait > 0) return rateLimited("Too many reset requests. Try again later.", wait);
  await recordHit(ipKey, RESET_IP_LIMIT);
  await recordHit(emailKey, RESET_EMAIL_LIMIT);

  await requestPasswordReset(email);
  return NextResponse.json({ ok: true, message: "If that address has a Sift account, a reset link is on its way." });
});
