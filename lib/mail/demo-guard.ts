import samples from "@/samples/emails.json";
import { type Mailer, type MailMessage, PermanentMailError } from "./config";

// The demo tickets' customer addresses look real (gmail.com, outlook.com, company domains).
const DEMO_ADDRESSES = new Set(samples.map((s) => s.from.email.trim().toLowerCase()));

/**
 * Production guard: refuses any message addressed to a samples/emails.json customer, so a leftover
 * demo ticket can never email a stranger. Permanent, so the reply fails at once with the reason.
 */
export class DemoRecipientGuard implements Mailer {
  constructor(private readonly real: Mailer) {}

  send(message: MailMessage): Promise<string> {
    const demo = [message.to].flat().find((a) => DEMO_ADDRESSES.has(a.trim().toLowerCase()));
    if (demo) {
      return Promise.reject(new PermanentMailError(`Refused: ${demo} is a demo sample address, not a real customer`));
    }
    return this.real.send(message);
  }
}
