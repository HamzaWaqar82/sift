// Mail types and configuration from the environment (no adapter imports, so adapters can use it).
import { randomUUID } from "node:crypto";

export type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Our generated Message-ID (angle brackets included); one is generated when omitted. */
  messageId?: string;
  /** Where the customer's reply goes; defaults to the From address. */
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
};

export interface Mailer {
  /** Hands the message to the transport and returns the provider's message id. Throws on failure. */
  send(message: MailMessage): Promise<string>;
}

/**
 * A rejection retrying can't fix (the recipient doesn't exist, the message is refused): the reply
 * is marked failed at once instead of being retried for hours. Anything else thrown is transient.
 */
export class PermanentMailError extends Error {
  override name = "PermanentMailError";
}

export const MAIL_TRANSPORTS = ["fake", "capture", "gmail"] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];

export const DEFAULT_FROM_NAME = "Sift Support";
export const DEFAULT_FROM_ADDRESS = "support@sift.local";

/** MAIL_TRANSPORT, defaulting to `capture` so a fresh checkout never sends real mail. */
export function mailTransport(): MailTransport {
  const value = process.env.MAIL_TRANSPORT?.trim() || "capture";
  if (!(MAIL_TRANSPORTS as readonly string[]).includes(value)) {
    throw new Error(`MAIL_TRANSPORT must be one of ${MAIL_TRANSPORTS.join(", ")} (got "${value}")`);
  }
  return value as MailTransport;
}

/** APP_ENV: development (default), staging or production. Staging runs a production build too. */
export function appEnv(): "development" | "staging" | "production" {
  const value = process.env.APP_ENV?.trim();
  return value === "production" || value === "staging" ? value : "development";
}

/**
 * /dev/mailbox exists only while mail is captured, and never in production. Outside production
 * the gmail transport still captures mail to anyone off MAIL_ALLOWED_RECIPIENTS, so it counts.
 */
export function devMailboxEnabled(): boolean {
  if (appEnv() === "production") return false;
  try {
    return mailTransport() !== "fake";
  } catch {
    return false;
  }
}

/** The From mailbox: MAIL_FROM_NAME (default "Sift Support") at GMAIL_USER, or a local address. */
export function mailFrom(): { name: string; address: string } {
  return {
    name: process.env.MAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME,
    address: process.env.GMAIL_USER?.trim() || DEFAULT_FROM_ADDRESS,
  };
}

/** GMAIL_USER and GMAIL_APP_PASSWORD (Google shows it in groups of four; spaces are dropped), or null. */
export function gmailCredentials(): { user: string; pass: string } | null {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  return user && pass ? { user, pass } : null;
}

/**
 * Fails fast on a mail setup that would lose replies: production must send through Gmail, and
 * the gmail transport needs its credentials. Called at app and worker startup and by getMailer().
 */
export function assertMailConfig(): void {
  const transport = mailTransport();
  if (appEnv() === "production" && transport !== "gmail") {
    throw new Error(`Production must send real mail: set MAIL_TRANSPORT=gmail (got "${transport}")`);
  }
  if (transport === "gmail" && !gmailCredentials()) {
    throw new Error("MAIL_TRANSPORT=gmail needs GMAIL_USER and GMAIL_APP_PASSWORD");
  }
}

/** MAIL_ALLOWED_RECIPIENTS: the only addresses a non-production gmail transport really mails. */
export function allowedRecipients(): Set<string> {
  const list = process.env.MAIL_ALLOWED_RECIPIENTS ?? "";
  return new Set(list.split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean));
}

/**
 * Staging shares production's Gmail account, so its replies ask customers to answer the
 * `+staging` alias, which only staging ingests. Elsewhere replies go to the From address.
 */
export function defaultReplyTo(): string | undefined {
  if (appEnv() !== "staging") return undefined;
  const [local, domain] = mailFrom().address.split("@");
  return domain ? `${local.replace(/\+.*$/, "")}+staging@${domain}` : undefined;
}

/** A fresh RFC 5322 Message-ID on the sending domain, e.g. `<uuid@gmail.com>`. */
export function generateMessageId(): string {
  const domain = mailFrom().address.split("@")[1] ?? "sift.local";
  return `<${randomUUID()}@${domain}>`;
}
