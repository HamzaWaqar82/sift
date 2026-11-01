import type { SendMailOptions } from "nodemailer";
import { defaultReplyTo, generateMessageId, type MailMessage, mailFrom } from "./config";

/** The nodemailer message every adapter sends: our From, Reply-To, Message-ID and threading headers. */
export function composeMail(message: MailMessage): SendMailOptions & { messageId: string } {
  return {
    from: mailFrom(),
    to: message.to,
    replyTo: message.replyTo ?? defaultReplyTo(),
    subject: message.subject,
    text: message.text,
    html: message.html,
    messageId: message.messageId ?? generateMessageId(),
    inReplyTo: message.inReplyTo,
    references: message.references,
  };
}
