import { z } from "zod";
import {
  failTriageJob,
  runTriageJob,
  TRIAGE_AUTO,
  TRIAGE_BACKOFF_SECONDS,
  TRIAGE_MANUAL,
  type TriageJobPayload,
} from "@/lib/triage";
import { registerJobHandler } from "../registry";

const payloadSchema = z.object({
  ticketId: z.number().int().positive(),
  lane: z.enum(["manual", "auto"]),
  requestedBy: z.number().int().nullable(),
  force: z.boolean().optional(),
});

/** An agent's Triage click (lib/triage requestTriage) and a new ticket's automatic triage. */
for (const kind of [TRIAGE_MANUAL, TRIAGE_AUTO]) {
  registerJobHandler<TriageJobPayload>(kind, {
    run: (payload, job) => runTriageJob(payloadSchema.parse(payload), job),
    backoffSeconds: TRIAGE_BACKOFF_SECONDS,
    onFailed: (payload, error) => failTriageJob(payloadSchema.parse(payload), error),
  });
}
