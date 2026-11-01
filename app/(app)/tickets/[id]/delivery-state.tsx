"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCw } from "lucide-react";
import type { MessageStatus } from "@/lib/db/schema";

/**
 * A reply that is not (yet) sent: a small stamp in place of the SENT rubber stamp. Sending… while
 * queued or with the mail server; Failed with the last error and Retry once retries ran out.
 * The SENT stamp replaces it (and lands) when the live update says the server accepted it.
 */
export function DeliveryState({
  ticketId,
  messageId,
  status,
  lastError,
  canRetry,
}: {
  ticketId: number;
  messageId: number;
  status: Exclude<MessageStatus, "sent">;
  lastError: string | null;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/messages/${messageId}/retry`, { method: "POST" }).catch(() => null);
    if (res?.ok) router.refresh();
    else setError((await res?.json().catch(() => null))?.error ?? "Could not retry. Try again.");
    setPending(false);
  }

  if (status === "queued" || status === "sending") {
    return (
      <p className="flex flex-col items-end gap-1" role="status">
        <span className="stamp" data-state="pending">
          Sending…
        </span>
        {lastError && <span className="max-w-[16rem] text-right text-xs text-ink-2">Retrying: {lastError}</span>}
      </p>
    );
  }

  return (
    <div className="flex max-w-[16rem] flex-col items-end gap-1.5">
      <span className="stamp" data-state="failed">
        {status === "bounced" ? "Bounced" : "Failed"}
      </span>
      {lastError && <p className="text-right text-xs text-jet-ink">{lastError}</p>}
      {status === "failed" && canRetry && (
        <button type="button" className="btn btn-sm" disabled={pending} aria-busy={pending} onClick={() => void retry()}>
          <RotateCw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          {pending ? "Retrying…" : "Retry"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-right text-xs text-jet-ink">
          {error}
        </p>
      )}
    </div>
  );
}
