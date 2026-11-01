import { NextResponse } from "next/server";
import { z } from "zod";
import { blockedFor, clientAddress, INVITE_ACCEPT_LIMIT, recordHit } from "@/lib/auth/rate-limit";
import { apiError, parseBody, rateLimited, route } from "@/lib/http";
import { acceptInvite, INVITE_INVALID_MESSAGE } from "@/lib/invitations";
import { lineField } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    token: z.string().min(1).max(200),
    name: lineField("Name", 100),
    // bcrypt only reads the first 72 bytes, so a longer password would be silently cut.
    password: z.string().min(10, "Use at least 10 characters").max(72, "Use 72 characters or fewer"),
  })
  .strict();

/**
 * Public (the token is the credential): sets the invitee's name and password, creates the verified
 * account and signs them in. 200 plus a session cookie. An unknown, expired, used or revoked link
 * all answer the same 410, so nothing reveals whether an account exists. 10 attempts per hour per IP.
 */
export const POST = route(async (req: Request) => {
  const keys = [`invite-accept:ip:${clientAddress(req)}`];
  const wait = await blockedFor(keys, INVITE_ACCEPT_LIMIT);
  if (wait > 0) return rateLimited("Too many attempts. Try again later.", wait);
  await recordHit(keys, INVITE_ACCEPT_LIMIT);

  const { token, name, password } = await parseBody(req, bodySchema, { maxBytes: 4 * 1024 });
  const result = await acceptInvite(token, { name, password }, req.headers);
  if (!result.ok) return apiError(410, INVITE_INVALID_MESSAGE, { code: "invite_invalid" });

  const res = NextResponse.json({ ok: true });
  for (const cookie of result.cookies) res.headers.append("set-cookie", cookie);
  return res;
});
