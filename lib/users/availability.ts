// Available/Away. Away users get no new tickets (see lib/tickets/auto-assign.ts) but keep the
// ones they own. Deactivated users count as Away whatever their stored value.
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { userAvailability, users } from "@/lib/db/schema";
import { publish } from "@/lib/events";

export type Availability = (typeof userAvailability.enumValues)[number];
export type Presence = { id: number; name: string; availability: Availability };

export const availabilitySchema = z
  .object({ availability: z.enum(userAvailability.enumValues, { error: "Must be available or away" }) })
  .strict();

/** The active team, by name, for the header's presence list. */
export async function listTeamPresence(): Promise<Presence[]> {
  return getDb()
    .select({ id: users.id, name: users.name, availability: users.availability })
    .from(users)
    .where(isNull(users.deactivatedAt))
    .orderBy(asc(users.name), asc(users.id));
}

/** Sets an active user's availability. Callers check self-or-admin first. Null: no such active user. */
export async function setAvailability(
  actorId: number,
  targetId: number,
  availability: Availability,
): Promise<Presence | null> {
  const active = and(eq(users.id, targetId), isNull(users.deactivatedAt));
  const [before] = await getDb().select({ availability: users.availability }).from(users).where(active);
  if (!before) return null;
  const [row] = await getDb()
    .update(users)
    .set({ availability, updatedAt: new Date() })
    .where(active)
    .returning({ id: users.id, name: users.name, availability: users.availability });
  if (row && before.availability !== availability) {
    await recordAudit({ actorId, action: "availability_changed", targetUserId: targetId, metadata: { to: availability } });
    await publish({ type: "presence.updated", userId: targetId, availability });
  }
  return row ?? null;
}
