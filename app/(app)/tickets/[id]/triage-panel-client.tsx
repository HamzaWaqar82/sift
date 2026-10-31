"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, CircleAlert, Clock, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import type { TriageView } from "@/lib/triage";
import { CategoryLabel, UrgencyTab } from "../../_components/ticket-labels";

/** TriageView as JSON (dates as ISO strings), as returned by /api/tickets/:id/triage. */
type Jsonify<T> = T extends unknown ? Omit<T, "createdAt"> & { createdAt: string } : never;
export type TriageViewJson = Jsonify<TriageView>;

type Problem = { kind: "cap" | "error"; message: string } | null;

function when(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const time = d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date} ${time} UTC`;
}

/**
 * AI triage strip: request (on demand, cost-capped), loading, the result (category, urgency,
 * source article), a failed attempt with its raw output collapsed, the daily cap, and the
 * admin-only regenerate with an inline confirm.
 */
export function TriagePanelClient({
  ticketId,
  initial,
  canRegenerate = false,
}: {
  ticketId: number;
  initial: TriageViewJson | null;
  canRegenerate?: boolean;
}) {
  const router = useRouter();
  const [triage, setTriage] = useState<TriageViewJson | null>(initial);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [lastInitialId, setLastInitialId] = useState(initial?.id ?? null);

  // A refresh brought a newer stored attempt (e.g. another tab regenerated): show it.
  if ((initial?.id ?? null) !== lastInitialId) {
    setLastInitialId(initial?.id ?? null);
    setTriage(initial);
  }

  async function run(force = false) {
    setConfirming(false);
    setPending(true);
    setProblem(null);
    try {
      const res = await fetch(
        `/api/tickets/${ticketId}/triage`,
        force
          ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) }
          : { method: "POST" },
      );
      const json = await res.json().catch(() => null);
      if (json?.triage) {
        setTriage(json.triage);
        // Re-render server parts (e.g. the reply editor prefilled from the draft).
        router.refresh();
      } else if (res.status === 429) {
        setProblem({ kind: "cap", message: json?.error ?? "Today's AI limit has been reached. Write the reply manually." });
      } else {
        setProblem({ kind: "error", message: json?.error ?? `Triage request failed (${res.status}).` });
      }
    } catch {
      setProblem({ kind: "error", message: "Could not reach the server. Try again." });
    } finally {
      setPending(false);
    }
  }

  const ok = triage?.status === "ok" ? triage : null;
  const failed = triage?.status === "error" ? triage : null;

  return (
    <section aria-label="AI triage" aria-busy={pending} className="coupon-quiet">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <h2 className="flex items-center gap-1.5 caps text-sm text-ink">
          <Sparkles className="size-4" strokeWidth={1.5} aria-hidden="true" />
          AI triage
        </h2>

        {ok && !pending && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <UrgencyTab urgency={ok.urgency} />
            <CategoryLabel category={ok.category} />
            {ok.article ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-ink-2">
                <BookOpen className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                <span className="truncate">{ok.article.title}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-warn-ink">
                <TriangleAlert className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                Not grounded
              </span>
            )}
            <span className="num text-xs" title={`Model ${ok.model}`}>
              {when(ok.createdAt)}
            </span>
          </div>
        )}
        {!triage && !pending && (
          <p className="flex-1 text-sm text-ink-2">Not triaged yet. Triage runs only when you ask, and counts toward today&apos;s AI limit.</p>
        )}
        {failed && !pending && <p className="flex-1 text-sm font-medium text-jet-ink">The latest triage attempt failed.</p>}
        {pending && (
          <div className="flex flex-1 items-center gap-3" role="status">
            <span className="sr-only">Asking the AI for a category, urgency and draft. This takes a few seconds.</span>
            <span className="skel h-5 w-14" aria-hidden="true" />
            <span className="skel h-3.5 w-20" aria-hidden="true" />
            <span className="skel h-3.5 w-40" aria-hidden="true" />
            <span className="text-xs text-ink-2" aria-hidden="true">
              Reading the ticket…
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {!ok && (
            <button type="button" onClick={() => run()} disabled={pending} className="btn btn-sm btn-navy">
              <Sparkles className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              {pending ? "Triaging…" : failed ? "Retry triage" : "Triage with AI"}
            </button>
          )}
          {ok && canRegenerate && !confirming && (
            <button type="button" onClick={() => setConfirming(true)} disabled={pending} className="btn btn-sm">
              <RefreshCw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              {pending ? "Regenerating…" : "Regenerate"}
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rule-soft bg-panel-2 px-4 py-3 text-sm" role="group" aria-label="Confirm regenerate">
          <p className="flex-1 text-ink-2">
            Regenerate makes a new AI call (it counts toward today&apos;s limit) and replaces the current draft for everyone.
          </p>
          <button type="button" className="btn btn-sm btn-navy" onClick={() => run(true)} autoFocus>
            Regenerate draft
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
            Keep current
          </button>
        </div>
      )}

      <div aria-live="polite">
        {problem && !pending && (
          <p
            role="alert"
            className={`flex items-start gap-2 border-t px-4 py-3 text-sm ${
              problem.kind === "cap" ? "border-warn-ink/30 bg-warn-tint text-warn-ink" : "border-jet-ink/30 bg-jet-tint text-jet-ink"
            }`}
          >
            {problem.kind === "cap" ? (
              <Clock className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            )}
            {problem.message}
          </p>
        )}
        {failed && !pending && (
          <div className="border-t border-jet-ink/30 bg-jet-tint px-4 py-3 text-sm text-jet-ink">
            <p>{failed.error}</p>
            <p className="mt-1 text-ink-2">
              The reply box keeps the last valid draft, if there is one. Otherwise write the reply by hand or retry.
            </p>
            {failed.rawOutput !== null && (
              <details className="mt-2">
                <summary className="cursor-pointer font-display text-xs font-semibold uppercase tracking-[0.08em] text-jet-ink">
                  Show raw AI output
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-rule-soft bg-panel p-2 font-mono text-xs text-ink">
                  {failed.rawOutput || "(empty)"}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
