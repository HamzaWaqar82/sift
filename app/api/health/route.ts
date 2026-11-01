import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { workerAlive } from "@/lib/worker/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Public liveness + DB connectivity check. Used by deploy smoke tests. The status code follows
 * the app and database only; `worker` reports the background worker's heartbeat alongside.
 */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    return NextResponse.json({ status: "error", db: "down", worker: "unknown" }, { status: 503 });
  }
  const worker = (await workerAlive().catch(() => false)) ? "up" : "down";
  return NextResponse.json({ status: "ok", db: "up", worker });
}
