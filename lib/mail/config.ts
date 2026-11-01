// Mail types and configuration from the environment (no adapter imports, so adapters can use it).
import { randomUUID } from "node:crypto";

export type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Our generated Message-ID (angle brackets included); one is generated when omitted. */
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
};

export interface Mailer {
  /** Hands the message to the transport and returns the provider's message id. Throws on failure. */
  send(message: MailMessage): Promise<string>;
}

export const MAIL_TRANSPORTS = ["fake", "capture"] as const;
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

/** /dev/mailbox exists only while mail is captured, and never in production. */
export function devMailboxEnabled(): boolean {
  if (appEnv() === "production") return false;
  try {
    return mailTransport() === "capture";
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

/** A fresh RFC 5322 Message-ID on the sending domain, e.g. `<uuid@gmail.com>`. */
export function generateMessageId(): string {
  const domain = mailFrom().address.split("@")[1] ?? "sift.local";
  return `<${randomUUID()}@${domain}>`;
}
