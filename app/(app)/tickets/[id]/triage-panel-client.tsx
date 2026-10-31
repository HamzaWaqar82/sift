"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TriageView } from "@/lib/triage";

/** TriageView as JSON (dates as ISO strings), as returned by /api/tickets/:id/triage. */
type Jsonify<T> = T extends unknown ? Omit<T, "createdAt"> & { createdAt: string } : never;
export type TriageViewJson = Jsonify<TriageView>;

const URGENCY_STYLES = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

export function TriagePanelClient({ ticketId, initial }: { ticketId: number; initial: TriageViewJson | null }) {
  const router = useRouter();
  const [triage, setTriage] = useState<TriageViewJson | null>(initial);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setRequestError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/triage`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (json?.triage) {
        setTriage(json.triage);
        // Re-render server parts (e.g. the reply editor prefilled from the draft).
        router.refresh();
      } else {
        setRequestError(json?.error ?? `Triage request failed (${res.status}).`);
      }
    } catch {
      setRequestError("Could not reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="AI triage" aria-busy={pending} className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">AI triage</h2>
        {triage?.status !== "ok" && (
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {pending ? "Triaging..." : triage?.status === "error" ? "Retry triage" : "Triage with AI"}
          </button>
        )}
      </div>

      {pending && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
          Asking the AI for a category, urgency and draft. This takes a few seconds.
        </p>
      )}

      {requestError && !pending && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {requestError}
        </p>
      )}

      {!triage && !pending && (
        <p className="mt-3 text-sm text-slate-500">Not triaged yet. Triage runs only when you ask for it.</p>
      )}

      {triage?.status === "error" && !pending && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-800">Triage failed. No draft is shown; write the reply manually or retry.</p>
          <p className="mt-1 text-red-700">{triage.error}</p>
          {triage.rawOutput !== null && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-red-700">Show raw AI output</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs text-slate-700">
                {triage.rawOutput || "(empty)"}
              </pre>
            </details>
          )}
        </div>
      )}

      {triage?.status === "ok" && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium capitalize text-indigo-800">
              {triage.category.replace("_", " ")}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${URGENCY_STYLES[triage.urgency]}`}>
              {triage.urgency} urgency
            </span>
            <span className="text-xs text-slate-500">
              {triage.article ? (
                <>
                  Based on: <span className="text-slate-700">{triage.article.title}</span>
                </>
              ) : (
                <span className="text-amber-700">Ungrounded: not based on any help article, review carefully</span>
              )}
            </span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Suggested draft (review before sending)</p>
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-slate-800">{triage.draft}</p>
          </div>
        </div>
      )}
    </section>
  );
}
