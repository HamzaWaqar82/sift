// The ticket permission matrix (spec "Permission matrix"), in one place. Route handlers ask
// `ticketPermission` before acting; the UI uses the same answers to decide what to show.
import { isAdmin, type SessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http";

/** Owner-gated capabilities: only the ticket's owner or an admin may do these. */
export type OwnerAction = "send" | "request_triage" | "retry_send" | "close" | "release";

export type Denial = { status: 403 | 409; code: "not_ticket_owner" | "ticket_unassigned" | "forbidden"; error: string };

type OwnedTicket = { assigneeId: number | null; assignee?: { name: string } | null };

const VERB: Record<OwnerAction, string> = {
  send: "reply to",
  request_triage: "triage",
  retry_send: "retry a reply on",
  close: "close",
  release: "release",
};

/**
 * null when `user` may do `action` on this ticket; otherwise why not. Admins may do everything.
 * Unowned tickets answer 409 `ticket_unassigned` (claim first), someone else's 403 `not_ticket_owner`.
 */
export function ticketPermission(user: SessionUser, action: OwnerAction, ticket: OwnedTicket): Denial | null {
  if (isAdmin(user) || ticket.assigneeId === user.id) return null;
  if (ticket.assigneeId === null) {
    return {
      status: 409,
      code: "ticket_unassigned",
      error: action === "release" ? "This ticket is already in the pool." : `Claim this ticket before you ${VERB[action]} it.`,
    };
  }
  const owner = ticket.assignee?.name;
  return {
    status: 403,
    code: "not_ticket_owner",
    error: `${owner ? `This ticket is owned by ${owner}.` : "Someone else owns this ticket."} Only the owner or an admin can ${VERB[action]} it.`,
  };
}

/** Regenerating a triage (a forced new AI call) is admin only, whoever owns the ticket. */
export function regeneratePermission(user: SessionUser): Denial | null {
  return isAdmin(user) ? null : { status: 403, code: "forbidden", error: "Only an admin can regenerate a triage." };
}

/** The uniform error response for a denial. */
export function denied(d: Denial): Response {
  return apiError(d.status, d.error, { code: d.code });
}
