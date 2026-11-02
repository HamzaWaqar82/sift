// Recurring jobs (the ownership sweeps): a job kind that schedules its own next run. Each run
// first queues the next one, so a sweep that throws never breaks the chain; the worker calls
// ensureRecurringJobs() on start to seed (or repair) it.
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { enqueueJob } from "./queue";
import { registerJobHandler } from "./registry";

const recurring = new Map<string, number>();

/** Registers `kind` to run every `everySeconds`. A failed run is not retried: the next one is already queued. */
export function registerRecurringJob(kind: string, everySeconds: number, run: () => Promise<void>) {
  recurring.set(kind, everySeconds);
  registerJobHandler(kind, {
    async run() {
      await queueIfMissing(kind, new Date(Date.now() + everySeconds * 1000));
      await run();
    },
  });
}

/** Makes sure every recurring kind has a queued run (due now if it had none). */
export async function ensureRecurringJobs() {
  for (const kind of recurring.keys()) await queueIfMissing(kind, new Date());
}

async function queueIfMissing(kind: string, runAt: Date) {
  const [queued] = await getDb().execute(sql`select 1 from jobs where kind = ${kind} and status = 'queued' limit 1`);
  if (!queued) await enqueueJob(kind, {}, { runAt, maxAttempts: 1 });
}
