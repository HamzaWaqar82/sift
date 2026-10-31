import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCredentials } from "@/lib/auth";
import {
  clearSignInFailures,
  clientAddress,
  recordSignInFailure,
  signInBlockedFor,
} from "@/lib/auth/rate-limit";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { apiError, HttpError, parseBody, route } from "@/lib/http";
import { cleanLine } from "@/lib/text";

export const dynamic = "force-dynamic";

const SignInBody = z
  .object({
    email: z
      .string()
      .transform((s) => cleanLine(s).trim().toLowerCase())
      .pipe(z.string().min(1).max(254)),
    password: z.string().min(1).max(200),
  })
  .strict();

/** POST {email, password} -> 200 {user} and a session cookie, or 400/401/429. */
export const POST = route(async (req: Request) => {
  const address = clientAddress(req);
  const retryAfter = signInBlockedFor(address);
  if (retryAfter > 0) {
    const res = apiError(429, "Too many failed sign-in attempts. Try again later.", { code: "rate_limited" });
    res.headers.set("retry-after", String(retryAfter));
    return res;
  }

  let body: z.infer<typeof SignInBody>;
  try {
    body = await parseBody(req, SignInBody, { maxBytes: 4 * 1024, message: "Email and password are required" });
  } catch (err) {
    // Keep the specific message for bad JSON/size; field detail is not useful on a sign-in form.
    if (err instanceof HttpError && err.code === "validation_failed") {
      throw new HttpError(400, "Email and password are required", "validation_failed");
    }
    throw err;
  }

  const user = await verifyCredentials(body.email, body.password);
  if (!user) {
    recordSignInFailure(address);
    return apiError(401, "Incorrect email or password", { code: "invalid_credentials" });
  }

  clearSignInFailures(address);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions());
  return res;
});
