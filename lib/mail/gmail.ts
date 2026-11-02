import { createTransport, type Transporter } from "nodemailer";
import { composeMail } from "./compose";
import { type Mailer, type MailMessage, PermanentMailError } from "./config";

export type SmtpOptions = { host: string; port: number; user: string; pass: string };

/** smtp.gmail.com over implicit TLS. GMAIL_SMTP_HOST/PORT exist so tests can point at a local server. */
export function gmailSmtpOptions(credentials: { user: string; pass: string }): SmtpOptions {
  return {
    host: process.env.GMAIL_SMTP_HOST?.trim() || "smtp.gmail.com",
    port: Number(process.env.GMAIL_SMTP_PORT) || 465,
    ...credentials,
  };
}

/**
 * Production adapter: sends through the dedicated Gmail account with an app password. One pooled
 * SMTP connection is reused between sends. Gmail keeps the Message-ID we set (the ticket 13 spike
 * checked it), so that id is what send() returns and what customers' replies point back to.
 */
export class GmailMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(options: SmtpOptions) {
    const secure = options.port === 465;
    const local = options.host === "localhost" || options.host === "127.0.0.1";
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      secure,
      requireTLS: !secure && !local,
      auth: { user: options.user, pass: options.pass },
      pool: true,
      maxConnections: 1,
      // nodemailer waits minutes by default; a stuck send must fail fast so the job can retry.
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
  }

  async send(message: MailMessage): Promise<string> {
    const mail = composeMail(message);
    try {
      await this.transport.sendMail(mail);
    } catch (error) {
      throw classifySmtpError(error);
    }
    return mail.messageId;
  }

  /** Connects and logs in without sending: the health check's "can we reach Gmail" probe. */
  async verify(): Promise<void> {
    await this.transport.verify();
  }

  close() {
    this.transport.close();
  }
}

type SmtpError = Error & { code?: string; responseCode?: number; response?: string };

/**
 * Maps an SMTP failure to what the queue should do. A 5xx refusal of the recipient or message is
 * permanent. Login failures, Gmail's daily sending limit (550 5.4.5) and network trouble are
 * transient: fixing the password or waiting a few hours lets the retries go through.
 */
export function classifySmtpError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const { code, responseCode, response } = error as SmtpError;
  const detail = (response || error.message).trim();
  if (code === "EAUTH") {
    return new Error(`Gmail refused the login; check GMAIL_USER and the app password (${detail})`);
  }
  if (responseCode && responseCode >= 500 && responseCode < 600) {
    if (/\b5\.4\.5\b|sending limit|quota/i.test(detail)) {
      return new Error(`Gmail's daily sending limit is reached; retrying later (${detail})`);
    }
    return new PermanentMailError(`Gmail rejected the message: ${detail}`);
  }
  return error;
}
