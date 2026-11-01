// The audit log: who did what. Later slices add their own actions (invites, role changes, ...).
import { getDb } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export type AuditAction =
  | "sign_in_failed"
  | "sessions_revoked"
  | "role_changed"
  | "user_deactivated"
  | "user_reactivated"
  | "ticket_claimed"
  | "ticket_released";

export async function recordAudit(entry: {
  /** Null means the system (or an unauthenticated caller). */
  actorId: number | null;
  action: AuditAction;
  ticketId?: number | null;
  targetUserId?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getDb()
    .insert(auditLog)
    .values({
      actorId: entry.actorId,
      action: entry.action,
      ticketId: entry.ticketId ?? null,
      targetUserId: entry.targetUserId ?? null,
      metadata: entry.metadata ?? null,
    });
}
