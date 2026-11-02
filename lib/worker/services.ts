// The worker's long-lived services. Each runs until its signal aborts; a service that throws
// is restarted after a pause so one bad connection never takes the others down.
import { setTimeout as sleep } from "node:timers/promises";
import { imapReader } from "@/lib/inbound/imap";
import { connectGmailInbox } from "@/lib/inbound/imap-client";
import { runDueJobs } from "@/lib/jobs";
import { HEARTBEAT_INTERVAL_MS, recordHeartbeat } from "./heartbeat";

export type WorkerService = { name: string; run(signal: AbortSignal): Promise<void> };

export const JOB_POLL_INTERVAL_MS = 2_000;

/** Calls runDueJobs() until stopped, pausing between empty passes. */
export const jobLoop: WorkerService = {
  name: "jobs",
  async run(signal) {
    while (!signal.aborted) {
      const summary = await runDueJobs();
      const busy = summary.succeeded + summary.retried + summary.deferred + summary.failed > 0;
      if (busy) console.log("[worker] jobs", JSON.stringify(summary));
      await pause(busy ? 0 : JOB_POLL_INTERVAL_MS, signal);
    }
  },
};

/** Liveness for /api/health, on its own timer so a long job doesn't look like a dead worker. */
export const heartbeat: WorkerService = {
  name: "heartbeat",
  async run(signal) {
    while (!signal.aborted) {
      await recordHeartbeat();
      await pause(HEARTBEAT_INTERVAL_MS, signal);
    }
  },
};

/** The IMAP reader (lib/inbound/imap.ts) connects only when MAIL_TRANSPORT=gmail. */
export const WORKER_SERVICES: WorkerService[] = [heartbeat, jobLoop, imapReader(connectGmailInbox)];

const RESTART_DELAY_MS = 5_000;

/** Runs every service until `signal` aborts, restarting any that crash. */
export async function runServices(services: WorkerService[], signal: AbortSignal) {
  await Promise.all(
    services.map(async (service) => {
      while (!signal.aborted) {
        try {
          await service.run(signal);
        } catch (error) {
          if (signal.aborted) break;
          console.error(`[worker] ${service.name} crashed; restarting`, error);
          await pause(RESTART_DELAY_MS, signal);
        }
      }
    }),
  );
}

async function pause(ms: number, signal: AbortSignal) {
  await sleep(ms, undefined, { signal }).catch(() => {});
}
