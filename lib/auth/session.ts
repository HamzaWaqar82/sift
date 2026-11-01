// Database sessions (Better Auth's `session` table): revocation and the session cookie.
import { eq } from "drizzle-orm";
import type { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { session } from "@/lib/db/schema";
import { getAuth } from "./better-auth";

/**
 * Signs a user out everywhere by deleting all their session rows, and records it in the audit log.
 * Used by "sign out everywhere"; deactivation, role and email changes call it too.
 * `actorId` is who did it (the user themselves, an admin, or null for the system).
 */
export async function revokeAllSessions(
  userId: number,
  opts: { actorId: number | null; reason: string },
): Promise<number> {
  const deleted = await getDb().delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
  await recordAudit({
    actorId: opts.actorId,
    action: "sessions_revoked",
    targetUserId: userId,
    metadata: { reason: opts.reason, sessions: deleted.length },
  });
  return deleted.length;
}

/** Expires the session cookie on a response (same name and attributes Better Auth set it with). */
export async function clearSessionCookie(res: NextResponse): Promise<void> {
  const { name, attributes } = (await getAuth().$context).authCookies.sessionToken;
  res.cookies.set(name, "", {
    httpOnly: attributes.httpOnly,
    secure: attributes.secure,
    sameSite: "lax",
    path: attributes.path,
    maxAge: 0,
  });
}
