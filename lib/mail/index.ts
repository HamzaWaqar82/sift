// Outbound mail: one `Mailer` interface, adapters chosen by MAIL_TRANSPORT.
//   fake    - in-memory recorder for tests (lib/mail/fake.ts)
//   capture - renders the full message and stores it in dev_mailbox, shown at /dev/mailbox
// Callers always go through getMailer(); tests swap in a FakeMailer with setMailer().
import { CaptureMailer } from "./capture";
import { type Mailer, type MailTransport, mailTransport } from "./config";
import { FakeMailer } from "./fake";

export * from "./config";
export { CaptureMailer, FakeMailer };
export type { SentMail } from "./fake";

let override: Mailer | null = null;
let cached: { transport: MailTransport; mailer: Mailer } | undefined;

/** The mailer for this process: the test override if set, else the MAIL_TRANSPORT adapter. */
export function getMailer(): Mailer {
  if (override) return override;
  const transport = mailTransport();
  if (cached?.transport !== transport) {
    cached = { transport, mailer: transport === "fake" ? new FakeMailer() : new CaptureMailer() };
  }
  return cached.mailer;
}

/** Replaces the mailer (tests); pass null to go back to MAIL_TRANSPORT. */
export function setMailer(mailer: Mailer | null) {
  override = mailer;
}
