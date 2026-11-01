"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Adds a staff-only note. Never emailed and never shown to the AI. */
export function NoteForm({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    }).catch(() => null);
    if (res?.ok) {
      setBody("");
      router.refresh();
    } else {
      const j = await res?.json().catch(() => null);
      setError(typeof j?.error === "string" ? j.error : "Could not add the note. Try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-2" aria-label="Add internal note">
      <label htmlFor={`note-${ticketId}`} className="field-label">
        Internal note <span className="normal-case tracking-normal text-ink-3">(staff only, never emailed)</span>
      </label>
      <textarea
        id={`note-${ticketId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={10000}
        className="w-full rounded-[var(--radius-control)] border border-carbon/40 bg-lilac-soft px-3 py-2 text-ink"
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || !body.trim()} className="btn btn-sm">
          {pending ? "Adding…" : "Add note"}
        </button>
        <p aria-live="polite" className="empty:hidden">
          {error && (
            <span role="alert" className="text-sm text-jet-ink">
              {error}
            </span>
          )}
        </p>
      </div>
    </form>
  );
}
