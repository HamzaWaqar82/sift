import { z } from "zod";
import { inviteLink, pendingInviteForMail } from "@/lib/invitations";
import { getMailer } from "@/lib/mail";
import { registerJobHandler } from "../registry";

export const MAIL_INVITE = "mail.invite";

const payloadSchema = z.object({ invitationId: z.number().int(), nonce: z.string() });

/**
 * Emails the invite link. The payload holds no token: the link is rebuilt from the invitation row,
 * and nothing is sent if the invite was revoked, accepted, expired or resent since.
 */
registerJobHandler(MAIL_INVITE, {
  async run(payload) {
    const { invitationId, nonce } = payloadSchema.parse(payload);
    const invite = await pendingInviteForMail(invitationId, nonce);
    if (!invite) return;
    const link = inviteLink(invite.token);
    const role = invite.row.role === "admin" ? "an admin" : "an agent";
    await getMailer().send({
      to: invite.row.email,
      subject: "You are invited to Sift",
      text: `You have been invited to join Sift as ${role}.\n\nOpen this link to set your name and password:\n${link}\n\nThe link works once and expires in 7 days. If you were not expecting this, ignore this email.`,
      html: `<p>You have been invited to join <strong>Sift</strong> as ${role}.</p><p><a href="${link}">Set your name and password</a></p><p>The link works once and expires in 7 days. If you were not expecting this, ignore this email.</p>`,
    });
  },
});
