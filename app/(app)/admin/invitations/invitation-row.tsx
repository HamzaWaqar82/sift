"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InviteSummary } from "@/lib/invitations";

const STATE: Record<InviteSummary["status"], string> = { pending: "open", accepted: "replied", expired: "closed", revoked: "closed" };

/** One invitation: status plus resend (pending or expired) and revoke (pending or expired). */
export function InvitationRow({ invite }: { invite: InviteSummary }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const live = invite.status === "pending" || invite.status === "expired";

  async function act(action: "resend" | "revoke") {
    setPending(true);
    setNote(null);
    const res = await fetch(`/api/admin/invitations/${invite.id}/${action}`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      if (action === "resend") setNote("Sent again.");
      router.refresh();
    } else {
      setNote((await res?.json().catch(() => null))?.error ?? "Could not save the change");
    }
    setPending(false);
  }

  return (
    <tr className="border-t border-rule-soft align-middle">
      <td className="px-3 py-2">
        <div className="break-all font-medium text-ink">{invite.email}</div>
        {invite.invitedBy && <div className="text-xs text-ink-3">Invited by {invite.invitedBy}</div>}
      </td>
      <td className="px-3 py-2 capitalize">{invite.role}</td>
      <td className="px-3 py-2">
        <span className="stamp" data-state={STATE[invite.status]}>
          {invite.status}
        </span>
      </td>
      <td className="num px-3 py-2 text-ink-2">
        {invite.status === "pending" || invite.status === "expired" ? invite.expiresAt.slice(0, 10) : ""}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {live && (
            <>
              <button type="button" disabled={pending} onClick={() => act("resend")} className="btn btn-sm">
                Resend
              </button>
              <button type="button" disabled={pending} onClick={() => act("revoke")} className="btn btn-sm">
                Revoke
              </button>
            </>
          )}
          <span aria-live="polite" className="text-xs text-ink-2">
            {note}
          </span>
        </div>
      </td>
    </tr>
  );
}
