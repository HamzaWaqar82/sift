import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { appBaseUrl, getAuth } from "@/lib/auth/better-auth";
import { blockedFor, clearHits, clientAddress, recordHit, SIGN_IN_LIMIT } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db";
import { users, type UserRole } from "@/lib/db/schema";
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

type BetterAuthUser = { id: string; email: string; name: string; role: string };

/**
 * POST {email, password} -> 200 {user} and a session cookie, or 400/401/403/429.
 * Better Auth's own sign-in endpoint does the work (credential check, session row, cookie, origin
 * check); this wrapper adds the database rate limit, the audit log and Sift's error shape.
 */
export const POST = route(async (req: Request) => {
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

  const ip = clientAddress(req);
  // Unknown emails get their own counter too, so they cost exactly what known ones do.
  const keys = [`sign-in:ip:${ip}`, `sign-in:email:${body.email}`];
  const retryAfter = await blockedFor(keys, SIGN_IN_LIMIT);
  if (retryAfter > 0) {
    const res = apiError(429, "Too many failed sign-in attempts. Try again later.", { code: "rate_limited" });
    res.headers.set("retry-after", String(retryAfter));
    return res;
  }

  const forwarded = new Headers(req.headers);
  forwarded.set("content-type", "application/json");
  forwarded.delete("content-length");
  const authRes = await getAuth().handler(
    new Request(new URL("/api/auth/sign-in/email", appBaseUrl()), {
      method: "POST",
      headers: forwarded,
      body: JSON.stringify({ email: body.email, password: body.password }),
    }),
  );

  if (authRes.status === 200) {
    await clearHits(keys);
    const { user } = (await authRes.json()) as { user: BetterAuthUser };
    const res = NextResponse.json({
      user: { id: Number(user.id), email: user.email, name: user.name, role: user.role as UserRole },
    });
    for (const cookie of authRes.headers.getSetCookie()) res.headers.append("set-cookie", cookie);
    return res;
  }
  if (authRes.status === 403) {
    return apiError(403, "Sign-in must come from the Sift app", { code: "forbidden" });
  }
  if (authRes.status !== 400 && authRes.status !== 401) {
    throw new Error(`Better Auth sign-in returned ${authRes.status}: ${await authRes.text()}`);
  }

  // Wrong password, unknown or malformed email, or a deactivated user: all look the same.
  await recordHit(keys, SIGN_IN_LIMIT);
  const [known] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  await recordAudit({
    actorId: null,
    action: "sign_in_failed",
    targetUserId: known?.id ?? null,
    metadata: { email: body.email, ip },
  });
  return apiError(401, "Incorrect email or password", { code: "invalid_credentials" });
});
