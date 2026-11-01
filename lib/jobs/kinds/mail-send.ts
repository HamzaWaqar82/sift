import { z } from "zod";
import { deliverMessage, MAIL_SEND, type MailSendPayload, markFailed } from "@/lib/replies/delivery";
import { DEFAULT_BACKOFF_SECONDS, registerJobHandler } from "../registry";

const payloadSchema = z.object({ messageId: z.number().int().positive() });

/** Delivers one queued reply; backoff 10s, 1m, 5m, 30m, then the message is marked failed. */
registerJobHandler<MailSendPayload>(MAIL_SEND, {
  backoffSeconds: DEFAULT_BACKOFF_SECONDS,
  async run(payload, job) {
    const { messageId } = payloadSchema.parse(payload);
    await deliverMessage(messageId, { final: job.attempts >= job.maxAttempts });
  },
  async onFailed(payload, error) {
    const parsed = payloadSchema.safeParse(payload);
    if (parsed.success) await markFailed(parsed.data.messageId, error);
  },
});
