"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Ban, Info, RotateCcw } from "lucide-react";
import type { TicketStatus } from "@/lib/db/schema";

/**
 * Close (VOID) or Reopen. Agents may close only after a reply has been sent (`canClose`); the
 * button says why it is unavailable instead of hiding. A 409 from the server is shown as-is.
 */
export function TicketActions({
  ticketId,
  status,
  canClose,
  admin,
}: {
  ticketId: number;
  status: TicketStatus;
  canClose: boolean;
  admin: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  async function post(action: "close" | "reopen") {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/${action}`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      router.refresh();
    } else {
      // e.g. 409 reply_required: an agent must send a reply before closing.
      const body = await res?.json().catch(() => null);
      setError(
        typeof body?.error === "string"
          ? body.error
          : action === "close"
            ? "Could not close the ticket. Try again."
            : "Could not reopen the ticket. Try again.",
      );
    }
    setPending(false);
  }

  const closed = status === "closed";
  return (
    <div className="flex max-w-[16rem] flex-col items-end gap-1.5 text-right">
      {closed ? (
        <button type="button" onClick={() => post("reopen")} disabled={pending} className="btn btn-sm">
          <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          {pending ? "Reopening…" : "Reopen ticket"}
        </button>
      ) : (
        <span className="group relative">
          {/* Unavailable (not removed): stays focusable so keyboard users get the reason too. */}
          <button
            type="button"
            onClick={() => canClose && post("close")}
            disabled={pending}
            aria-disabled={!canClose || undefined}
            aria-describedby={!canClose ? noteId : undefined}
            className="btn btn-sm"
          >
            <Ban className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            {pending ? "Closing…" : "Close ticket"}
            {!canClose && <Info className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
          </button>
          {!canClose && (
            <span
              id={noteId}
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 w-60 rounded-[var(--radius-control)] bg-ink px-3 py-2 text-left text-xs leading-snug text-white opacity-0 shadow-[var(--shadow-pop)] transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
            >
              Send a reply first. Agents can close a ticket once a reply has been sent.
            </span>
          )}
        </span>
      )}
      {!closed && admin && (
        <p className="text-xs text-ink-3">Admins can close without a reply.</p>
      )}
      <div aria-live="polite" className="w-full empty:hidden">
        {error && (
          <p role="alert" className="text-sm text-jet-ink">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
