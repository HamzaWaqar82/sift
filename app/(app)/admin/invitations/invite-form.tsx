"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = { kind: "edit" } | { kind: "confirm"; email: string; role: string };

/** Two steps: type the address, then see it back before anything is sent. */
export function InviteForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "edit" });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function review(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setMessage(null);
    setStep({ kind: "confirm", email: String(form.get("email")).trim(), role: String(form.get("role")) });
  }

  async function send() {
    if (step.kind !== "confirm") return;
    setPending(true);
    setMessage(null);
    const res = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: step.email, role: step.role }),
    }).catch(() => null);
    if (res?.ok) {
      setMessage({ tone: "ok", text: `Invitation sent to ${step.email.toLowerCase()}.` });
      setStep({ kind: "edit" });
      router.refresh();
    } else {
      const body = await res?.json().catch(() => null);
      setMessage({ tone: "error", text: body?.fields?.email ?? body?.error ?? "Could not send the invitation" });
      setStep({ kind: "edit" });
    }
    setPending(false);
  }

  return (
    <div className="coupon-quiet p-4">
      {step.kind === "edit" ? (
        <form onSubmit={review} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="invite-email" className="label">
              Email to invite
            </label>
            <input id="invite-email" name="email" type="email" required placeholder="teammate@company.com" className="input" />
          </div>
          <div>
            <label htmlFor="invite-role" className="label">
              Role
            </label>
            <select id="invite-role" name="role" defaultValue="agent" className="input">
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit" className="btn btn-navy">
            Review invitation
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink">
            Send an invitation to <strong className="break-all">{step.email.toLowerCase()}</strong> as{" "}
            {step.role === "admin" ? "an admin" : "an agent"}? Check the address: the link goes only there.
          </p>
          <button type="button" onClick={send} disabled={pending} className="btn btn-navy">
            {pending ? "Sending…" : "Send invitation"}
          </button>
          <button type="button" onClick={() => setStep({ kind: "edit" })} disabled={pending} className="btn">
            Change
          </button>
        </div>
      )}
      <p aria-live="polite" className="mt-2 text-sm empty:hidden">
        {message && <span className={message.tone === "error" ? "text-jet-ink" : "text-ink-2"}>{message.text}</span>}
      </p>
    </div>
  );
}
