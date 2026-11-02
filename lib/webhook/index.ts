// Inbound-email webhook: the shared-secret check and the payload shape (the format of
// samples/emails.json and samples/live/*.json). The route handler is app/api/webhook/route.ts.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { InboundMail } from "@/lib/inbound";
import { emailField, lineField, optionalLineField, textField } from "@/lib/validation";

export const WEBHOOK_SECRET_HEADER = "x-webhook-secret";

/**
 * Constant-time secret comparison. Both sides are hashed first so the buffers have equal
 * length and the comparison leaks neither content nor length. An unset secret never matches.
 */
export function webhookSecretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Largest accepted request body, in bytes. */
export const WEBHOOK_MAX_BYTES = 64 * 1024;

export const inboundEmailSchema = z
  .object({
    from: z
      .object({
        email: emailField("from.email must be a valid email address"),
        name: optionalLineField("from.name", 200).nullable(),
      })
      .strict(),
    subject: lineField("subject", 500),
    body: textField("body", 50_000),
    /** Accepted (and checked) for compatibility, but not used: tickets are ordered by server receive time. */
    received_at: z.iso.datetime({ offset: true, message: "received_at must be an ISO 8601 date-time" }).optional(),
    message_id: lineField("message_id", 500),
  })
  .strict();

export type InboundEmail = z.infer<typeof inboundEmailSchema>;

/**
 * Maps a validated JSON email to the shared ingest input. Times are the server's receive time;
 * the sender's received_at is untrusted and never decides list order.
 */
export function toInboundMail(email: InboundEmail): InboundMail {
  return {
    messageId: email.message_id,
    from: { email: email.from.email, name: email.from.name || null },
    to: null,
    subject: email.subject,
    text: email.body,
    html: null,
    inReplyTo: null,
    references: [],
    source: "webhook",
  };
}
