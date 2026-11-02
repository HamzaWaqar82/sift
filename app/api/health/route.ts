import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { imapHealth } from "@/lib/inbound/imap";
import { mailHealth } from "@/lib/mail/health";
import { workerAlive } from "@/lib/worker/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Public liveness + DB connectivity check. Used by deploy smoke tests. The status code follows
 * the app and database only; `worker` reports the background worker's heartbeat and `mail`
 * whether Gmail SMTP accepts our login (or which non-delivering transport is configured), and
 * `imap` whether the worker's IMAP reader is connected (`off` unless MAIL_TRANSPORT=gmail).
 */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    return NextResponse.json({ status: "error", db: "down", worker: "unknown", mail: "unknown", imap: "unknown" }, { status: 503 });
  }
  const [alive, mail, imap] = await Promise.all([workerAlive().catch(() => false), mailHealth(), imapHealth()]);
  return NextResponse.json({ status: "ok", db: "up", worker: alive ? "up" : "down", mail, imap });
}
