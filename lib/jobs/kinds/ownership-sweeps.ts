import { ackTimeoutSweep, overdueSweep } from "@/lib/tickets/sweeps";
import { registerRecurringJob } from "../recurring";

export const ACK_TIMEOUT_SWEEP = "assign.ack_timeout";
export const OVERDUE_SWEEP = "ticket.overdue_sweep";

/** Unopened auto-assignments move on, and overdue tickets return to the pool, checked every 5 minutes. */
registerRecurringJob(ACK_TIMEOUT_SWEEP, 5 * 60, ackTimeoutSweep);
registerRecurringJob(OVERDUE_SWEEP, 5 * 60, overdueSweep);
