import { generateMessageId, type Mailer, type MailMessage, mailFrom } from "./config";

export type SentMail = MailMessage & { from: { name: string; address: string }; to: string[]; messageId: string };

/** In-memory mailer for tests: records every send, and can be told to fail. */
export class FakeMailer implements Mailer {
  readonly sent: SentMail[] = [];
  private failure: Error | null = null;

  async send(message: MailMessage): Promise<string> {
    if (this.failure) throw this.failure;
    const mail: SentMail = {
      ...message,
      from: mailFrom(),
      to: [message.to].flat(),
      messageId: message.messageId ?? generateMessageId(),
    };
    this.sent.push(mail);
    return mail.messageId;
  }

  /** Every later send throws `error` until called again with null. */
  failWith(error: Error | null) {
    this.failure = error;
  }
}
