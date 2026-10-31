// Inbound-email webhook: the shared-secret check and the payload shape (the format of
// samples/emails.json and samples/live/*.json). The route handler is app/api/webhook/route.ts.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { NewTicket } from "@/lib/tickets";

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

/**
 * Reads the body as text, or returns null once it exceeds `maxBytes`. A declared
 * Content-Length over the limit is refused without reading; otherwise the stream is
 * counted as it arrives and cancelled at the limit, so a missing or false length cannot
 * make the server buffer more than `maxBytes`.
 */
export async function readBodyWithLimit(req: Request, maxBytes = WEBHOOK_MAX_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const inboundEmailSchema = z.object({
  from: z.object({
    email: z.string().trim().toLowerCase().pipe(z.email("from.email must be a valid email address")),
    name: z.string().trim().max(200).optional().nullable(),
  }),
  subject: z.string().trim().min(1, "subject is required").max(500),
  body: z.string().trim().min(1, "body is required").max(50_000),
  received_at: z.iso.datetime({ offset: true, message: "received_at must be an ISO 8601 date-time" }),
  message_id: z.string().trim().min(1, "message_id is required").max(500),
});

export type InboundEmail = z.infer<typeof inboundEmailSchema>;

/** { "from.email": "first message", ... }; issues on the whole payload are keyed "payload". */
export function payloadErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "payload";
    out[key] ??= issue.message;
  }
  return out;
}

/** Maps a validated inbound email to a new webhook ticket. */
export function toNewTicket(email: InboundEmail): NewTicket {
  return {
    customerEmail: email.from.email,
    customerName: email.from.name || null,
    subject: email.subject,
    body: email.body,
    source: "webhook",
    externalMessageId: email.message_id,
    createdAt: new Date(email.received_at),
  };
}
