import { z } from "zod";
import { ticketStatus } from "@/lib/db/schema";

/** The agent's "new ticket" form (customer email, subject, body). */
export const ticketFormSchema = z.object({
  customerEmail: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  customerName: z
    .string()
    .trim()
    .max(200, "Name is too long")
    .optional()
    .transform((v) => (v ? v : undefined)),
  subject: z.string().trim().min(1, "Subject is required").max(200, "Subject must be 200 characters or fewer"),
  body: z.string().trim().min(1, "Message is required").max(20_000, "Message must be 20,000 characters or fewer"),
});

export type TicketFormInput = z.infer<typeof ticketFormSchema>;

export const TICKET_STATUSES = ticketStatus.enumValues;

/** List filters carried in the URL. */
export const listQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
});

/** A ticket id from a URL segment, or null if it is not a positive integer. */
export function parseTicketId(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}
