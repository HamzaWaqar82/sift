import { NextResponse } from "next/server";
import { apiError, parseBody, route } from "@/lib/http";
import { createTicket } from "@/lib/tickets";
import {
  inboundEmailSchema,
  toNewTicket,
  WEBHOOK_MAX_BYTES,
  WEBHOOK_SECRET_HEADER,
  webhookSecretMatches,
} from "@/lib/webhook";

export const dynamic = "force-dynamic";

/** POST /api/webhook: one inbound email (JSON) becomes one ticket. Contract in the README. */
export const POST = route(async (req: Request) => {
  if (!webhookSecretMatches(req.headers.get(WEBHOOK_SECRET_HEADER), process.env.WEBHOOK_SECRET)) {
    return apiError(401, "Missing or wrong webhook secret", { code: "unauthorized" });
  }

  const email = await parseBody(req, inboundEmailSchema, {
    maxBytes: WEBHOOK_MAX_BYTES,
    message: "Invalid email payload",
    rootKey: "payload",
  });
  const { ticket, created } = await createTicket(toNewTicket(email));
  return NextResponse.json({ ticket, created }, { status: created ? 201 : 200 });
});
