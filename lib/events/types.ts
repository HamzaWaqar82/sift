// The one list of live events. Payloads carry ids and small facts only, never customer text:
// clients refetch what they display. Shared by the server bus and the browser client.
import type { MessageDirection, MessageStatus, TicketStatus } from "@/lib/db/schema";

export type SiftEvent =
  | { type: "ticket.created"; ticketId: number; status: TicketStatus; assigneeId: number | null }
  | { type: "ticket.updated"; ticketId: number; status: TicketStatus }
  /** `actorId` is who assigned it: null for automatic routing and sweeps. */
  | { type: "ticket.assigned"; ticketId: number; assigneeId: number; actorId: number | null }
  | { type: "ticket.released"; ticketId: number }
  /** `authorName` is the staff member's name (outbound only), for "<name> just replied". */
  | {
      type: "message.created";
      ticketId: number;
      messageId: number;
      direction: MessageDirection;
      authorId: number | null;
      authorName: string | null;
    }
  | { type: "message.status_changed"; ticketId: number; messageId: number; status: MessageStatus }
  | { type: "note.created"; ticketId: number; noteId: number; authorId: number }
  | { type: "triage.updated"; ticketId: number }
  | { type: "overdue.marked"; ticketId: number }
  | { type: "presence.updated"; userId: number; availability: "available" | "away" }
  | { type: "ai_budget.updated" };

export type SiftEventType = SiftEvent["type"];
