import { NextResponse } from "next/server";
import { createTicket } from "@/lib/tickets";
import { fieldErrors } from "@/lib/validation";
import {
  inboundEmailSchema,
  readBodyWithLimit,
  toNewTicket,
  WEBHOOK_MAX_BYTES,
  WEBHOOK_SECRET_HEADER,
  webhookSecretMatches,
} from "@/lib/webhook";

export const dynamic = "force-dynamic";

/** POST /api/webhook: one inbound email (JSON) becomes one ticket. Contract in the README. */
export async function POST(req: Request) {
  if (!webhookSecretMatches(req.headers.get(WEBHOOK_SECRET_HEADER), process.env.WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Missing or wrong webhook secret" }, { status: 401 });
  }

  const text = await readBodyWithLimit(req);
  if (text === null) {
    return NextResponse.json(
      { error: `Body exceeds the ${WEBHOOK_MAX_BYTES / 1024} KiB limit` },
      { status: 413 },
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = inboundEmailSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid email payload", fields: fieldErrors(parsed.error, "payload") },
      { status: 400 },
    );
  }

  const { ticket, created } = await createTicket(toNewTicket(parsed.data));
  return NextResponse.json({ ticket, created }, { status: created ? 201 : 200 });
}
