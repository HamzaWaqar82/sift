"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, CircleAlert, Clock, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import type { TriageStateName, TriageView } from "@/lib/triage";
import { CategoryLabel, UrgencyTab } from "../../_components/ticket-labels";

/** TriageView as JSON (dates as ISO strings), as returned by /api/tickets/:id/triage. */
type Jsonify<T> = T extends unknown ? Omit<T, "createdAt"> & { createdAt: string } : never;
export type TriageViewJson = Jsonify<TriageView>;
export type TriageStateJson = { state: TriageStateName; retryAt: string | null };

/** While a job is on its way, refetch in case the live connection missed the event. */
const POLL_MS: Partial<Record<TriageStateName, number>> = {
  queued: 4000,
  running: 4000,
  waiting_rate_limit: 15_000,
  daily_cap_reached: 60_000,
};

function when(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${date} ${clock(iso)} UTC`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

/**
 * AI triage strip. Shows the ticket's triage state (Queued, Triaging…, Triaged, Waiting on AI
 * limit, Daily AI limit reached, Failed, Out of date) and the result. A click enqueues a job;
 * the result arrives through live events, with a short poll as a fallback. Admins can
 * regenerate with an inline confirm.
 */
export function TriagePanelClient({
  ticketId,
  initial,
  state,
  hasValid = false,
  canRequest = true,
  canRegenerate = false,
}: {
  ticketId: number;
  initial: TriageViewJson | null;
  state: TriageStateJson;
  /** A valid triage exists (so a failed attempt was a regenerate, which only an admin can retry). */
  hasValid?: boolean;
  /** Only the owner or an admin may ask for a triage (others still see the result). */
  canRequest?: boolean;
  canRegenerate?: boolean;
}) {
  const router = useRouter();
  const [posting, setPosting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const poll = POLL_MS[state.state];
  useEffect(() => {
    if (!poll) return;
    const t = setInterval(() => router.refresh(), poll);
    return () => clearInterval(t);
  }, [poll, router]);

  async function run(force = false) {
    setConfirming(false);
    setPosting(true);
    setProblem(null);
    try {
      const res = await fetch(
        `/api/tickets/${ticketId}/triage`,
        force
          ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) }
          : { method: "POST" },
      );
      if (res.ok) {
        // 202 queued or 200 cached: the server-rendered panel now shows the new state.
        router.refresh();
      } else {
        const json = await res.json().catch(() => null);
        setProblem(json?.error ?? `Triage request failed (${res.status}).`);
      }
    } catch {
      setProblem("Could not reach the server. Try again.");
    } finally {
      setPosting(false);
    }
  }

  const s = state.state;
  const working = posting || s === "queued" || s === "running";
  const ok = initial?.status === "ok" ? initial : null;
  const failed = s === "failed" && initial?.status === "error" ? initial : null;
  const showResult = ok && (s === "done" || s === "superseded" || (!working && s !== "failed"));

  return (
    <section aria-label="AI triage" aria-busy={working} className="coupon-quiet">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <h2 className="flex items-center gap-1.5 caps text-sm text-ink">
          <Sparkles className="size-4" strokeWidth={1.5} aria-hidden="true" />
          AI triage
        </h2>

        <div aria-live="polite" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {working && (
            <span className="flex items-center gap-3" role="status">
              <span className="skel h-5 w-14" aria-hidden="true" />
              <span className="skel h-3.5 w-20" aria-hidden="true" />
              <span className="text-xs text-ink-2">{s === "running" ? "Triaging…" : "Queued"}</span>
            </span>
          )}
          {!working && s === "waiting_rate_limit" && (
            <span className="inline-flex items-center gap-1.5 font-medium text-warn-ink" role="status">
              <Clock className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              Waiting on AI limit{state.retryAt && <>, retries at <span className="num">{clock(state.retryAt)} UTC</span></>}
            </span>
          )}
          {!working && s === "daily_cap_reached" && (
            <span className="inline-flex items-center gap-1.5 font-medium text-warn-ink" role="status">
              <Clock className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              Daily AI limit reached. Write the reply manually, or wait for{" "}
              {state.retryAt ? <span className="num">{when(state.retryAt)}</span> : "tomorrow"}.
            </span>
          )}
          {!working && s === "failed" && <span className="font-medium text-jet-ink">Failed</span>}
          {!working && s === "none" && (
            <span className="text-ink-2">
              {canRequest
                ? "Not triaged yet. Triage counts toward today’s AI limit."
                : "Not triaged yet. The ticket’s owner can run triage."}
            </span>
          )}
          {showResult && !working && (
            <>
              {s === "superseded" && (
                <span className="tab" data-tone="ground" title="The customer wrote again after this triage">
                  Out of date
                </span>
              )}
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
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {canRequest && !working && (s === "none" || (s === "failed" && !hasValid) || s === "superseded") && (
            <button type="button" onClick={() => run()} className="btn btn-sm btn-navy">
              <Sparkles className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              {s === "failed" ? "Retry" : s === "superseded" ? "Re-triage" : "Triage with AI"}
            </button>
          )}
          {((ok && s === "done") || (s === "failed" && hasValid)) && canRegenerate && !confirming && !working && (
            <button type="button" onClick={() => setConfirming(true)} className="btn btn-sm">
              <RefreshCw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              Regenerate
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
        {problem && !posting && (
          <p role="alert" className="flex items-start gap-2 border-t border-jet-ink/30 bg-jet-tint px-4 py-3 text-sm text-jet-ink">
            <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {problem}
          </p>
        )}
        {failed && !working && (
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
