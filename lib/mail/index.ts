// Outbound mail: one `Mailer` interface, adapters chosen by MAIL_TRANSPORT.
//   fake    - in-memory recorder for tests (lib/mail/fake.ts)
//   capture - renders the full message and stores it in dev_mailbox, shown at /dev/mailbox
//   gmail   - the dedicated Gmail account over SMTP (lib/mail/gmail.ts). Outside production it
//             only mails MAIL_ALLOWED_RECIPIENTS and captures the rest (lib/mail/allowlist.ts).
// Callers always go through getMailer(); tests swap in a FakeMailer with setMailer().
import { AllowlistMailer } from "./allowlist";
import { CaptureMailer } from "./capture";
import { appEnv, assertMailConfig, gmailCredentials, type Mailer, mailTransport } from "./config";
import { FakeMailer } from "./fake";
import { GmailMailer, gmailSmtpOptions } from "./gmail";

export * from "./config";
export { AllowlistMailer, CaptureMailer, FakeMailer, GmailMailer };
export type { SentMail } from "./fake";

let override: Mailer | null = null;
let cached: { key: string; mailer: Mailer } | undefined;

/** The mailer for this process: the test override if set, else the MAIL_TRANSPORT adapter. */
export function getMailer(): Mailer {
  if (override) return override;
  assertMailConfig();
  const transport = mailTransport();
  const key = `${transport}:${appEnv()}:${process.env.GMAIL_USER}:${process.env.MAIL_ALLOWED_RECIPIENTS}`;
  if (cached?.key !== key) {
    if (cached?.mailer instanceof GmailMailer) cached.mailer.close();
    cached = { key, mailer: createMailer(transport) };
  }
  return cached.mailer;
}

function createMailer(transport: ReturnType<typeof mailTransport>): Mailer {
  if (transport === "fake") return new FakeMailer();
  if (transport === "capture") return new CaptureMailer();
  const gmail = new GmailMailer(gmailSmtpOptions(gmailCredentials()!));
  return appEnv() === "production" ? gmail : new AllowlistMailer(gmail, new CaptureMailer());
}

/** Replaces the mailer (tests); pass null to go back to MAIL_TRANSPORT. */
export function setMailer(mailer: Mailer | null) {
  override = mailer;
}
