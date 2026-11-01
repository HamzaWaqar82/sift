// The one place route handlers and pages get the current user and enforce roles.
//
// Route handlers:
//   const user = await requireUser(req);  if (user instanceof Response) return user;  // 401
//   const admin = await requireAdmin(req); if (admin instanceof Response) return admin; // 401/403
// Pages / server components:
//   const user = await requirePageUser();   // redirects to /sign-in when signed out
//
// Every call resolves the session cookie against the `session` table (Better Auth), so a revoked
// or expired session, or a deactivated user, is signed out immediately.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { UserRole } from "@/lib/db/schema";
import { getAuth } from "./better-auth";

export type SessionUser = { id: number; email: string; name: string; role: UserRole };

async function userFromHeaders(h: Headers): Promise<SessionUser | null> {
  const result = await getAuth().api.getSession({ headers: h });
  if (!result || result.user.deactivatedAt) return null;
  const { user } = result;
  // Better Auth hands ids over as strings ("2"); Sift's are integers.
  return { id: Number(user.id), email: user.email, name: user.name, role: user.role as UserRole };
}

/** The signed-in user for a route-handler request, or null. */
export async function getCurrentUser(req: Request): Promise<SessionUser | null> {
  return userFromHeaders(req.headers);
}

/** The signed-in user, or a 401 JSON Response to return as-is. */
export async function requireUser(req: Request): Promise<SessionUser | Response> {
  const user = await getCurrentUser(req);
  return user ?? NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
}

/** Whether this user may do admin-only things (reassign, regenerate triage). The one role check. */
export function isAdmin(user: Pick<SessionUser, "role"> | null | undefined): boolean {
  return user?.role === "admin";
}

/** The signed-in admin, else a 401 (signed out) or 403 (not an admin) Response. */
export async function requireAdmin(req: Request): Promise<SessionUser | Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "You do not have permission to do that", code: "forbidden" }, { status: 403 });
  }
  return user;
}

/** The signed-in user in a server component / server action, or null. */
export async function getPageUser(): Promise<SessionUser | null> {
  return userFromHeaders(await headers());
}

/** The signed-in user in a server component; redirects to /sign-in when signed out. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getPageUser();
  if (!user) redirect("/sign-in");
  return user;
}
