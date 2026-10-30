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

export const dynamic = "force-dynamic";

const SignInBody = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

/** POST {email, password} -> 200 {user} and a session cookie, or 400/401/429. */
export async function POST(req: Request) {
  const address = clientAddress(req);
  const retryAfter = signInBlockedFor(address);
  if (retryAfter > 0) {
    return NextResponse.json(
      { error: "Too many failed sign-in attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const parsed = SignInBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    recordSignInFailure(address);
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  clearSignInFailures(address);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions());
  return res;
}
