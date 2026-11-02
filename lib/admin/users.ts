// Admin user management: list the team, change roles, deactivate and reactivate (never delete).
// Each change is audited, and role changes and deactivation revoke the user's sessions.
import { asc, desc, eq, lt, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { auditLog, users, type UserRole } from "@/lib/db/schema";
import { releaseTicketsOf } from "@/lib/tickets/sweeps";

export type AdminUser = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  availability: "available" | "away";
  active: boolean;
  deactivatedAt: string | null;
};

export async function listUsers(): Promise<AdminUser[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      availability: users.availability,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .orderBy(asc(users.name), asc(users.id));
  return rows.map((r) => ({ ...r, active: !r.deactivatedAt, deactivatedAt: r.deactivatedAt?.toISOString() ?? null }));
}

export type UserChange = { ok: true; user: AdminUser } | { ok: false; reason: "not-found" | "self" };

async function userById(id: number): Promise<AdminUser | null> {
  return (await listUsers()).find((u) => u.id === id) ?? null;
}

// Admins cannot demote or deactivate themselves: it is how a team ends up with no admin.
async function guard(actorId: number, targetId: number): Promise<{ ok: false; reason: "not-found" | "self" } | AdminUser> {
  if (actorId === targetId) return { ok: false, reason: "self" };
  return (await userById(targetId)) ?? { ok: false, reason: "not-found" };
}

export async function changeRole(actorId: number, targetId: number, role: UserRole): Promise<UserChange> {
  const found = await guard(actorId, targetId);
  if ("ok" in found) return found;
  if (found.role !== role) {
    await getDb().update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, targetId));
    await recordAudit({ actorId, action: "role_changed", targetUserId: targetId, metadata: { from: found.role, to: role } });
    await revokeAllSessions(targetId, { actorId, reason: "role_changed" });
  }
  return { ok: true, user: (await userById(targetId))! };
}

/** Sets the user Away, signs them out everywhere and releases their open tickets to the pool. */
export async function deactivateUser(actorId: number, targetId: number): Promise<UserChange> {
  const found = await guard(actorId, targetId);
  if ("ok" in found) return found;
  if (found.active) {
    await getDb()
      .update(users)
      .set({ deactivatedAt: new Date(), availability: "away", updatedAt: new Date() })
      .where(eq(users.id, targetId));
    await recordAudit({ actorId, action: "user_deactivated", targetUserId: targetId });
    await revokeAllSessions(targetId, { actorId, reason: "deactivated" });
    await releaseTicketsOf(targetId, actorId);
  }
  return { ok: true, user: (await userById(targetId))! };
}

/** Lets a deactivated user sign in again. They stay Away until they set themselves available. */
export async function reactivateUser(actorId: number, targetId: number): Promise<UserChange> {
  const found = await guard(actorId, targetId);
  if ("ok" in found) return found;
  if (!found.active) {
    await getDb().update(users).set({ deactivatedAt: null, updatedAt: new Date() }).where(eq(users.id, targetId));
    await recordAudit({ actorId, action: "user_reactivated", targetUserId: targetId });
  }
  return { ok: true, user: (await userById(targetId))! };
}

export type AuditEntry = {
  id: number;
  action: string;
  actor: string | null;
  target: string | null;
  ticketId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

/** Newest first; `before` is the id of the last entry already shown. */
export async function listAudit(opts: { limit?: number; before?: number } = {}): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await getDb()
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actor: sql<string | null>`(select name from users where users.id = ${auditLog.actorId})`,
      target: sql<string | null>`(select name from users where users.id = ${auditLog.targetUserId})`,
      ticketId: auditLog.ticketId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(opts.before ? lt(auditLog.id, opts.before) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
