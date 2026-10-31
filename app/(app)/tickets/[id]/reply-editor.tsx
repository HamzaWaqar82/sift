"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Reply box, prefilled with the AI draft when one exists. Sending is an explicit click.
 * One idempotency key per compose session, so a double click or retry records one reply.
 */
export function ReplyEditor({ ticketId, draft }: { ticketId: number; draft: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(draft ?? "");
  const [touched, setTouched] = useState(false);
  const [shownDraft, setShownDraft] = useState(draft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const sending = useRef(false);

  // A new draft (e.g. triage just ran) replaces the box only if the agent has not typed yet.
  if (draft !== shownDraft) {
    setShownDraft(draft);
    if (!touched) setText(draft ?? "");
  }

  async function send() {
    if (sending.current) return;
    if (!text.trim()) {
      setError("Reply cannot be empty");
      return;
    }
    sending.current = true;
    key.current ??= newKey();
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: text, idempotencyKey: key.current }),
    }).catch(() => null);
    if (res?.ok) {
      key.current = null;
      setText("");
      setTouched(true);
      router.refresh();
    } else {
      const json = await res?.json().catch(() => null);
      setError(json?.fields?.body ?? json?.error ?? "Could not send the reply. Try again.");
    }
    sending.current = false;
    setPending(false);
  }

  return (
    <form
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor="reply" className="block text-sm font-medium text-slate-700">
        Reply{" "}
        {draft !== null && (
          <span className="font-normal text-slate-500">(starts from the AI draft; review before sending)</span>
        )}
      </label>
      <textarea
        id="reply"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setTouched(true);
          if (error) setError(null);
        }}
        rows={8}
        maxLength={20_000}
        placeholder="Write a reply..."
        className="w-full rounded-md border border-slate-300 p-2 text-sm text-slate-800 focus:border-slate-500 focus:outline-none"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Recorded in Sift only; no email is sent to the customer.</p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {pending ? "Sending..." : "Send reply"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
