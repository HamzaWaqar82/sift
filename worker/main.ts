// Worker process entry: `node worker.mjs` in the runner image (bundled by `npm run build:worker`),
// or `npm run worker` in development. Runs a single instance next to the app.
import { assertMailConfig } from "@/lib/mail/config";
import { runServices, WORKER_SERVICES } from "@/lib/worker/services";

// Refuse to start with a mail setup that would swallow replies (see assertMailConfig).
assertMailConfig();

const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`[worker] ${signal}: finishing current work`);
    controller.abort();
  });
}

console.log(`[worker] started: ${WORKER_SERVICES.map((s) => s.name).join(", ")}`);
await runServices(WORKER_SERVICES, controller.signal);
console.log("[worker] stopped");
process.exit(0);
