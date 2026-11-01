import { createTransport } from "nodemailer";
import { getDb } from "@/lib/db";
import { devMailbox } from "@/lib/db/schema";
import { generateMessageId, type Mailer, type MailMessage, mailFrom } from "./config";
import { parseHeaders } from "./headers";

// nodemailer's stream transport builds the exact MIME a real SMTP send would, without a network.
const renderer = createTransport({ streamTransport: true, buffer: true, newline: "unix" });

export type RenderedMail = { messageId: string; from: string; to: string; raw: string };

/** Renders a message to its full RFC 5322 text (headers and body) with our From and Message-ID. */
export async function renderMail(message: MailMessage): Promise<RenderedMail> {
  const from = mailFrom();
  const messageId = message.messageId ?? generateMessageId();
  const info = await renderer.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    messageId,
    inReplyTo: message.inReplyTo,
    references: message.references,
  });
  const raw = (info.message as Buffer).toString("utf8");
  const header = (name: string) => parseHeaders(raw).find(([n]) => n.toLowerCase() === name)?.[1] ?? "";
  return { messageId, from: header("from"), to: header("to"), raw };
}

/** Dev/staging adapter: stores the rendered message in dev_mailbox instead of delivering it. */
export class CaptureMailer implements Mailer {
  async send(message: MailMessage): Promise<string> {
    const rendered = await renderMail(message);
    await getDb()
      .insert(devMailbox)
      .values({
        messageId: rendered.messageId,
        from: rendered.from,
        to: rendered.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? null,
        raw: rendered.raw,
      });
    return rendered.messageId;
  }
}
