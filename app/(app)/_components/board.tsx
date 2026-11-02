"use client";

import Link from "next/link";
import { useState } from "react";
import type { TicketCard } from "../_lib/cards";
import type { TicketStatus } from "@/lib/db/schema";
import { LABELS } from "../_lib/params";
import { OverdueBadge, StatusStamp, TicketNo, TriageMarker, timeAgo, stampTime } from "./ticket-labels";


type Column = { count: number; nextCursor: string | null; tickets: TicketCard[] };
const ORDER: TicketStatus[] = ["open", "replied", "closed"];

/** Three status columns with live counts; each column loads more with its own cursor. */
export function Board({
  columns,
  query,
}: {
  columns: Partial<Record<string, Column>>;
  query: string;
  params: Record<string, string>;
}) {
  const shown = ORDER.filter((s) => columns[s]);
  return (
    // Narrow screens: columns side by side with snap scrolling (no endless stacked list).
    <div
      className={`-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 lg:mx-0 lg:grid lg:snap-none lg:gap-4 lg:overflow-visible lg:px-0 ${
        shown.length === 3 ? "lg:grid-cols-3" : shown.length === 2 ? "lg:grid-cols-2" : ""
      }`}
    >
      {shown.map((s) => (
        <BoardColumn key={s} status={s} initial={columns[s]!} query={query} />
      ))}
    </div>
  );
}

function BoardColumn({ status, initial, query }: { status: TicketStatus; initial: Column; query: string }) {
  const [tickets, setTickets] = useState(initial.tickets);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = `col-${status}`;

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(query);
      qs.set("column", status);
      qs.set("cursor", cursor);
      qs.set("limit", "20");
      const res = await fetch(`/api/tickets/board?${qs}`);
      const json = await res.json().catch(() => null);
      const col = json?.columns?.[status];
      if (!res.ok || !col) throw new Error(json?.error ?? "Could not load more tickets.");
      setTickets((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...(col.tickets as TicketCard[]).filter((t) => !seen.has(t.id))];
      });
      setCursor(col.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more tickets.");
    }
    setLoading(false);
  }

  return (
    <section aria-labelledby={headingId} className="flex w-[85vw] max-w-sm shrink-0 snap-start flex-col sm:w-80 lg:w-auto lg:max-w-none">
      <div className="tab-row pl-3">
        <h2 id={headingId} className="tab" data-tone={status === "closed" ? "red" : "navy"}>
          {LABELS.status[status]}
          <span className="font-mono text-2xs font-medium tabular-nums">{initial.count}</span>
        </h2>
      </div>
      {/* Each column scrolls on its own, so its tabbed head stays in view. */}
      <div className="max-h-[70vh] overflow-y-auto rounded-[var(--radius-coupon)] border border-rule bg-panel-2 p-2 lg:max-h-[calc(100vh-15.5rem)]">
        {tickets.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-2">No {LABELS.status[status].toLowerCase()} tickets match.</p>
        ) : (
          <ul className="space-y-2" aria-busy={loading}>
            {tickets.map((t) => (
              <li key={t.id} data-ticket-id={t.id}>
                <Link
                  href={`/tickets/${t.id}`}
                  data-ticket-row
                  className="block rounded-[var(--radius-coupon)] border border-rule-soft bg-panel transition-colors duration-150 hover:border-ink"
                >
                  <div className="flex items-center justify-between gap-2 px-3 pt-2">
                    <TicketNo id={t.id} className="text-xs font-medium" />
                    <time dateTime={t.createdAt} title={stampTime(new Date(t.createdAt))} className="num text-xs" suppressHydrationWarning>
                      {timeAgo(new Date(t.createdAt))}
                    </time>
                  </div>
                  <p className="line-clamp-2 px-3 pt-1 text-sm font-medium leading-snug text-ink">
                    {t.overdueWaitingSince && (
                      <>
                        <OverdueBadge since={t.overdueWaitingSince} />{" "}
                      </>
                    )}
                    {t.subject}
                  </p>
                  <p className="truncate px-3 text-xs text-ink-2">
                    {t.customerName ?? t.customerEmail} <span className="text-ink-3">/</span>{" "}
                    <span className={t.assignee ? "" : "text-ink-3"}>{t.assignee?.name ?? "Unassigned"}</span>
                  </p>
                  <div className="perf mx-0 mt-2" style={{ ["--perf-bg" as string]: "var(--color-panel-2)" }} aria-hidden="true" />
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <TriageMarker triage={t.triage} />
                    {status !== t.status && <StatusStamp status={t.status} />}
                  </div>
                </Link>
              </li>
            ))}
            {loading &&
              [0, 1].map((i) => (
                <li key={`sk-${i}`} aria-hidden="true" className="space-y-2 rounded-[var(--radius-coupon)] border border-rule-soft bg-panel p-3">
                  <div className="skel h-3 w-16" />
                  <div className="skel h-3.5 w-4/5" />
                  <div className="skel h-3 w-1/2" />
                </li>
              ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-2 px-1 text-sm text-jet-ink">
            {error}
          </p>
        )}
        {cursor && (
          <button type="button" onClick={loadMore} disabled={loading} className="btn btn-sm mt-2 w-full">
            {loading ? "Loading…" : `Load more (${initial.count - tickets.length} left)`}
          </button>
        )}
      </div>
    </section>
  );
}
