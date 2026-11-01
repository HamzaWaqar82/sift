"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Hand, Undo2 } from "lucide-react";

async function post(url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }).catch(() => null);
  if (res?.ok) return { ok: true };
  const json = await res?.json().catch(() => null);
  return { ok: false, error: typeof json?.error === "string" ? json.error : "Something went wrong. Try again." };
}

/**
 * Take an unowned ticket. If someone else got there first the server says who (409
 * `already_claimed`); the message stays and the page refreshes to show the new owner.
 */
export function ClaimButton({ ticketId, className = "btn btn-sm btn-navy" }: { ticketId: number; className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setPending(true);
    setError(null);
    const r = await post(`/api/tickets/${ticketId}/claim`);
    if (!r.ok) setError(r.error!);
    setPending(false);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={claim} disabled={pending} className={className}>
        <Hand className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        {pending ? "Claiming…" : "Claim ticket"}
      </button>
      <span aria-live="polite" className="text-sm empty:hidden">
        {error && (
          <span role="alert" className="text-jet-ink">
            {error}
          </span>
        )}
      </span>
    </span>
  );
}

/** Hand the ticket back to the pool, with an optional reason (posted as an internal note). */
export function ReleaseButton({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function release(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await post(`/api/tickets/${ticketId}/release`, reason.trim() ? { reason } : undefined);
    setPending(false);
    if (!r.ok) return setError(r.error!);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-sm btn-ghost">
        <Undo2 className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        Release
      </button>
    );
  }
  return (
    <form onSubmit={release} className="flex w-full flex-wrap items-center gap-1.5" aria-label="Release to the pool">
      <label htmlFor={id} className="sr-only">
        Reason (optional)
      </label>
      <input
        id={id}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
        autoFocus
        placeholder="Reason (optional)"
        className="h-[1.875rem] min-w-0 flex-1 rounded-[var(--radius-control)] border border-ink-3 bg-panel px-2 text-sm text-ink hover:border-ink"
      />
      <button type="submit" disabled={pending} className="btn btn-sm">
        {pending ? "Releasing…" : "Release to pool"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn btn-sm btn-ghost">
        Cancel
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-jet-ink">
          {error}
        </p>
      )}
    </form>
  );
}
