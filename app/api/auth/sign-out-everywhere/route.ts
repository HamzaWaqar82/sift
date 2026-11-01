import { requireUser } from "@/lib/auth";
import { clearSessionCookie, revokeAllSessions } from "@/lib/auth/session";
import { relativeRedirect, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST (plain HTML form) -> revokes every session of the signed-in user, then redirects to /sign-in. */
export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  await revokeAllSessions(user.id, { actorId: user.id, reason: "sign_out_everywhere" });
  const res = relativeRedirect("/sign-in", 303);
  await clearSessionCookie(res);
  return res;
});
