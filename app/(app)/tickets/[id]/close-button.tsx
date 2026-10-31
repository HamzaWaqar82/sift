"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CloseTicketButton({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/close`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      router.refresh();
    } else {
      setError("Could not close the ticket");
    }
    setPending(false);
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={close}
        disabled={pending}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Closing..." : "Close ticket"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
