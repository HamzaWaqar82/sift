import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tickets } from "@/lib/db/schema";
import { apiError, parseBody, route } from "@/lib/http";
import { ingestMail } from "@/lib/inbound";
import { appEnv } from "@/lib/mail/config";
import {
  inboundEmailSchema,
  toInboundMail,
  WEBHOOK_MAX_BYTES,
  WEBHOOK_SECRET_HEADER,
  webhookSecretMatches,
} from "@/lib/webhook";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhook: one inbound email (JSON), for dev and tests. It goes through the same ingest
 * path as real mail, so a follow-up threads into its ticket. Production reads mail over IMAP only.
 */
export const POST = route(async (req: Request) => {
  if (appEnv() === "production") return apiError(404, "Not found", { code: "not_found" });
  if (!webhookSecretMatches(req.headers.get(WEBHOOK_SECRET_HEADER), process.env.WEBHOOK_SECRET)) {
    return apiError(401, "Missing or wrong webhook secret", { code: "unauthorized" });
  }

  const email = await parseBody(req, inboundEmailSchema, {
    maxBytes: WEBHOOK_MAX_BYTES,
    message: "Invalid email payload",
    rootKey: "payload",
  });
  const result = await ingestMail(toInboundMail(email));
  // A JSON email always has a sender, so the outcome is a ticket, an append or a duplicate.
  const ticketId = "ticketId" in result ? result.ticketId : null;
  const [ticket] = ticketId === null ? [] : await getDb().select().from(tickets).where(eq(tickets.id, ticketId));
  const created = result.kind === "ticket";
  return NextResponse.json({ ticket: ticket ?? null, created }, { status: created ? 201 : 200 });
});
