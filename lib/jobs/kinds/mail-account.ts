import { z } from "zod";
import { accountLink, usableTokenForMail } from "@/lib/auth/account-tokens";
import { getMailer } from "@/lib/mail";
import { registerJobHandler } from "../registry";

export const MAIL_ACCOUNT_LINK = "mail.account_link";

const payloadSchema = z.object({ tokenId: z.number().int(), nonce: z.string() });

/**
 * Emails a password-reset or email-confirmation link. The payload holds no token: the link is
 * rebuilt from the token row, and nothing is sent once the link is used or expired.
 */
registerJobHandler(MAIL_ACCOUNT_LINK, {
  async run(payload) {
    const { tokenId, nonce } = payloadSchema.parse(payload);
    const row = await usableTokenForMail(tokenId, nonce);
    if (!row) return;
    const link = accountLink(row);
    if (row.purpose === "password_reset") {
      await getMailer().send({
        to: row.to,
        subject: "Reset your Sift password",
        text: `Someone asked to reset the password for your Sift account.\n\nOpen this link to choose a new password:\n${link}\n\nThe link works once and expires in 1 hour. If this was not you, ignore this email; your password stays the same.`,
        html: `<p>Someone asked to reset the password for your <strong>Sift</strong> account.</p><p><a href="${link}">Choose a new password</a></p><p>The link works once and expires in 1 hour. If this was not you, ignore this email; your password stays the same.</p>`,
      });
    } else {
      await getMailer().send({
        to: row.to,
        subject: "Confirm your new Sift email address",
        text: `Confirm that this is the new email address for your Sift account:\n${link}\n\nUntil you confirm, you keep signing in with your old address. The link works once and expires in 24 hours.`,
        html: `<p>Confirm that this is the new email address for your <strong>Sift</strong> account.</p><p><a href="${link}">Confirm this address</a></p><p>Until you confirm, you keep signing in with your old address. The link works once and expires in 24 hours.</p>`,
      });
    }
  },
});
