import { allowedRecipients, type Mailer, type MailMessage } from "./config";

/**
 * Staging guard around the real transport: a message goes out only when every recipient is on
 * MAIL_ALLOWED_RECIPIENTS; anything else is captured instead, so testing never mails a customer.
 */
export class AllowlistMailer implements Mailer {
  constructor(
    private readonly real: Mailer,
    private readonly fallback: Mailer,
    private readonly allowed: Set<string> = allowedRecipients(),
  ) {}

  send(message: MailMessage): Promise<string> {
    const recipients = [message.to].flat().map((a) => a.trim().toLowerCase());
    const allowed = recipients.length > 0 && recipients.every((a) => this.allowed.has(a));
    return (allowed ? this.real : this.fallback).send(message);
  }
}
