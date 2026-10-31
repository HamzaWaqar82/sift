// The one place route handlers and pages get the current user and enforce roles.
//
// Route handlers:
//   const user = await requireUser(req);  if (user instanceof Response) return user;  // 401
//   const admin = await requireAdmin(req); if (admin instanceof Response) return admin; // 401/403
// Pages / server components:
//   const user = await requirePageUser();   // redirects to /sign-in when signed out
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, type UserRole } from "@/lib/db/schema";
import { cookieValue, readSessionToken, SESSION_COOKIE } from "./session";

export type SessionUser = { id: number; email: string; name: string; role: UserRole };

async function loadUser(id: number | null): Promise<SessionUser | null> {
  if (id === null) return null;
  const [row] = await getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}

/** The signed-in user for a route-handler request, or null. */
export async function getCurrentUser(req: Request): Promise<SessionUser | null> {
  const token = cookieValue(req.headers.get("cookie"), SESSION_COOKIE);
  return loadUser(await readSessionToken(token));
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
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return loadUser(await readSessionToken(token));
}

/** The signed-in user in a server component; redirects to /sign-in when signed out. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getPageUser();
  if (!user) redirect("/sign-in");
  return user;
}

// A real cost-10 hash of a throwaway string, so unknown emails cost the same bcrypt time as known ones.
const DUMMY_HASH = "$2b$10$uTLG9i9T8cEa84mFwduvCuhKK7St1mYKTWXWVhDhJkBte2ocdW9dy";

/** Checks an email/password pair against the seeded users. */
export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const [row] = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !ok) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
