import { gmailCredentials, mailTransport } from "./config";
import { GmailMailer, gmailSmtpOptions } from "./gmail";

export type MailHealth = "up" | "down" | "capture" | "fake" | "misconfigured";

/** One Gmail login per 5 minutes at most: /api/health is public, and Google flags login storms. */
export const MAIL_PROBE_TTL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8_000;

let probe: { key: string; at: number; result: Promise<"up" | "down"> } | undefined;

/** Whether mail can go out: for gmail, a cached SMTP connect-and-login; otherwise the transport name. */
export async function mailHealth(now = Date.now()): Promise<MailHealth> {
  let transport;
  try {
    transport = mailTransport();
  } catch {
    return "misconfigured";
  }
  if (transport !== "gmail") return transport;
  const credentials = gmailCredentials();
  if (!credentials) return "misconfigured";

  const options = gmailSmtpOptions(credentials);
  const key = `${options.host}:${options.port}:${options.user}`;
  if (!probe || probe.key !== key || now - probe.at > MAIL_PROBE_TTL_MS) {
    probe = { key, at: now, result: verify(new GmailMailer(options)) };
  }
  return probe.result;
}

async function verify(mailer: GmailMailer): Promise<"up" | "down"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SMTP probe timed out")), PROBE_TIMEOUT_MS);
  });
  try {
    await Promise.race([mailer.verify(), timeout]);
    return "up";
  } catch (error) {
    console.error("[mail] SMTP health probe failed:", error instanceof Error ? error.message : error);
    return "down";
  } finally {
    clearTimeout(timer);
    mailer.close();
  }
}

/** Forgets the cached probe (tests). */
export function resetMailHealth() {
  probe = undefined;
}
