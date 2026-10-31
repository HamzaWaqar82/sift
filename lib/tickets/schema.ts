import { z } from "zod";
import { ticketStatus } from "@/lib/db/schema";
import { emailField, lineField, optionalLineField, textField } from "@/lib/validation";
import { parseIntId } from "@/lib/http";

/** Field limits shared by the form and the webhook. */
export const LIMITS = { name: 200, subject: 200, body: 20_000 } as const;

/** The agent's "new ticket" form (customer email, subject, body). Unknown keys are rejected. */
export const ticketFormSchema = z
  .object({
    customerEmail: emailField(),
    customerName: optionalLineField("Name", LIMITS.name),
    subject: lineField("Subject", LIMITS.subject),
    body: textField("Message", LIMITS.body),
  })
  .strict();

export type TicketFormInput = z.infer<typeof ticketFormSchema>;

export const TICKET_STATUSES = ticketStatus.enumValues;

/** A ticket id from a URL segment, or null if it is not a positive int4 (never throws). */
export function parseTicketId(raw: string): number | null {
  return parseIntId(raw);
}
