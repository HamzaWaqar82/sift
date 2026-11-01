"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";

/** Admin only: queues a test email to themselves; the worker delivers it into this mailbox. */
export function SendTestEmail() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "queued" | "error">("idle");

  async function send() {
    setState("pending");
    const res = await fetch("/api/admin/test-email", { method: "POST" }).catch(() => null);
    if (!res?.ok) return setState("error");
    setState("queued");
    // The worker polls every couple of seconds; refresh once it has had a chance to send.
    setTimeout(() => router.refresh(), 3000);
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={send} disabled={state === "pending"} className="btn btn-sm">
        <Send className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        {state === "pending" ? "Queueing…" : "Send test email"}
      </button>
      <span role="status" className="text-sm text-ink-2">
        {state === "queued" && "Queued. It appears here once the worker sends it."}
        {state === "error" && "Could not queue the test email. Try again."}
      </span>
    </div>
  );
}
