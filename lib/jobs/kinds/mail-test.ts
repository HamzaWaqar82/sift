import { z } from "zod";
import { getMailer } from "@/lib/mail";
import { registerJobHandler } from "../registry";

export const MAIL_TEST = "mail.test";

const payloadSchema = z.object({ to: z.string(), requestedBy: z.string() });
export type MailTestPayload = z.infer<typeof payloadSchema>;

/** An admin's test email: proves the worker and the mail transport end to end. */
registerJobHandler<MailTestPayload>(MAIL_TEST, {
  async run(payload) {
    const { to, requestedBy } = payloadSchema.parse(payload);
    await getMailer().send({
      to,
      subject: "Sift test email",
      text: `This is a test email from Sift, requested by ${requestedBy}.\n\nIf you can read this, the worker and the mail transport are working.`,
      html: `<p>This is a test email from <strong>Sift</strong>, requested by ${escapeHtml(requestedBy)}.</p><p>If you can read this, the worker and the mail transport are working.</p>`,
    });
  },
});

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
