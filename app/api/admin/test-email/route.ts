import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { parseBody, route } from "@/lib/http";
import { enqueueJob, MAIL_TEST } from "@/lib/jobs";
import { emailField } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ to: emailField().optional() }).strict();

/**
 * Admin only: queue a test email (to the admin unless `to` is given). The worker sends it through
 * the configured transport; with `capture` it appears at /dev/mailbox. Returns 202 { jobId }.
 */
export const POST = route(async (req: Request) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const { to } = await parseBody(req, bodySchema, { allowEmpty: true, message: "Body must be { to?: email }" });
  const jobId = await enqueueJob(MAIL_TEST, { to: to ?? admin.email, requestedBy: admin.name });
  return NextResponse.json({ jobId }, { status: 202 });
});
