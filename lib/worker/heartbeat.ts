import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export const WORKER_NAME = "worker";
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** The worker counts as alive while its last beat is younger than this (a few missed beats). */
export const HEARTBEAT_STALE_MS = 60_000;

export async function recordHeartbeat(name = WORKER_NAME) {
  await getDb().execute(sql`
    insert into worker_heartbeats (name, beat_at) values (${name}, now())
    on conflict (name) do update set beat_at = excluded.beat_at`);
}

/** True when the worker has beaten within HEARTBEAT_STALE_MS (by the database clock). */
export async function workerAlive(name = WORKER_NAME): Promise<boolean> {
  const [row] = await getDb().execute<{ alive: boolean }>(sql`
    select beat_at > now() - make_interval(secs => ${HEARTBEAT_STALE_MS / 1000}) as alive
    from worker_heartbeats where name = ${name}`);
  return row?.alive === true;
}
