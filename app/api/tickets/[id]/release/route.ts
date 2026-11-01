import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError, parseBody, route } from "@/lib/http";
import { getTicket, releaseTicket } from "@/lib/tickets";
import { ticketNotFound, type TicketRouteContext } from "@/lib/tickets/http";
import { denied, ticketPermission } from "@/lib/tickets/permissions";
import { parseTicketId } from "@/lib/tickets/schema";
import { cleanText } from "@/lib/text";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    reason: z
      .string()
      .transform((s) => cleanText(s).trim())
      .pipe(z.string().max(1000, "Reason must be 1,000 characters or fewer"))
      .optional(),
  })
  .strict();

/**
 * Release a ticket to the pool: its owner or an admin. Optional body `{ reason }`; a non-empty
 * reason is kept on the ticket and posted as an internal note.
 */
export const POST = route(async (req: Request, ctx: TicketRouteContext) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const id = parseTicketId((await ctx.params).id);
  if (id === null) return ticketNotFound();
  const { reason } = await parseBody(req, bodySchema, {
    allowEmpty: true,
    message: "Body must be empty or { reason: string }",
  });

  const ticket = await getTicket(id);
  if (!ticket) return ticketNotFound();
  const denial = ticketPermission(user, "release", ticket);
  if (denial) return denied(denial);

  const result = await releaseTicket(id, { actorId: user.id, expectedOwnerId: ticket.assigneeId!, reason: reason || null });
  if (!result.ok) {
    return apiError(409, "The owner changed while you were releasing it. Reload and try again.", { code: "owner_changed" });
  }
  return NextResponse.json({ ticket: result.ticket });
});
