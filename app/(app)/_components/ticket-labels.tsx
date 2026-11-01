import { Mail, PenLine } from "lucide-react";
import type { TicketSource, TicketStatus, TriageCategory, TriageUrgency } from "@/lib/db/schema";
import type { TriageSummary } from "@/lib/tickets";
import { LABELS } from "../_lib/params";

/** "#0042": the ticket number in carbon-purple tabular numerals. */
export function TicketNo({ id, className = "" }: { id: number; className?: string }) {
  return (
    <span className={`num ${className}`} aria-label={`Ticket ${id}`}>
      #{String(id).padStart(4, "0")}
    </span>
  );
}

/** Status as a small stamp: OPEN (navy), REPLIED (carbon), CLOSED (red). */
export function StatusStamp({ status }: { status: TicketStatus }) {
  return (
    <span className={`stamp ${status === "closed" ? "bg-jet-tint" : ""}`} data-state={status}>
      {LABELS.status[status]}
    </span>
  );
}

const URGENCY_STYLE: Record<TriageUrgency, string> = {
  high: "bg-jet text-white border-jet",
  medium: "bg-panel text-ink border-ink",
  low: "bg-panel text-ink-2 border-rule-soft",
};

/** Urgency tab: HIGH is the only red one in the list. */
export function UrgencyTab({ urgency }: { urgency: TriageUrgency }) {
  return (
    <span
      className={`inline-flex h-5 items-center border px-1.5 font-display text-2xs font-semibold uppercase tracking-[0.08em] ${URGENCY_STYLE[urgency]}`}
      style={{ clipPath: "polygon(4px 0, 100% 0, 100% 100%, 0 100%, 0 4px)" }}
    >
      <span className="sr-only">Urgency </span>
      {LABELS.urgency[urgency]}
    </span>
  );
}

export function CategoryLabel({ category }: { category: TriageCategory }) {
  return (
    <span className="font-display text-xs font-semibold uppercase tracking-[0.07em] text-ink-2">
      <span className="sr-only">Category </span>
      {LABELS.category[category]}
    </span>
  );
}

export function SourceLabel({ source, withIcon = false }: { source: TicketSource; withIcon?: boolean }) {
  const Icon = source === "webhook" ? Mail : PenLine;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2">
      {withIcon && <Icon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
      {LABELS.source[source]}
    </span>
  );
}

/** Category + urgency of the current triage; a "not triaged" / "triage failed" marker otherwise. */
export function TriageMarker({ triage }: { triage: TriageSummary }) {
  // Only triaged values get chips; the rest is a quiet hollow dot with a tooltip.
  if (!triage || !triage.ok) {
    const label = triage ? "Triage failed" : "Not triaged";
    return (
      <span className="inline-flex size-5 items-center justify-center" title={label}>
        <span aria-hidden="true" className={`size-2 rounded-full border-[1.5px] ${triage ? "border-jet-ink" : "border-ink-3"}`} />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <UrgencyTab urgency={triage.urgency} />
      <CategoryLabel category={triage.category} />
    </span>
  );
}

/** "5m", "3h", "4d", then a date. Short form for dense lists. */
export function timeAgo(date: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`;
  return date.toISOString().slice(0, 10);
}

/** "1d 4h", "5h", "40m": how long the customer has waited. */
export function waitFor(since: Date, now = new Date()): string {
  const m = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  return h > 0 ? `${h}h` : `${m}m`;
}

/** Orange "OVERDUE 1d 4h" chip before the subject; nothing when the ticket isn't overdue. */
export function OverdueBadge({ since }: { since: Date | string | null }) {
  if (!since) return null;
  const at = new Date(since);
  return (
    <span
      className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[2px] border border-overdue-ink bg-overdue-tint px-1 text-overdue-ink"
      title={`Customer waiting since ${stampTime(at)}`}
    >
      <span className="font-display text-2xs font-semibold uppercase tracking-[0.08em]">Overdue</span>
      <span className="font-mono text-2xs tabular-nums" suppressHydrationWarning>
        {waitFor(at)}
      </span>
    </span>
  );
}

/** "31 Oct 14:05 UTC": an unambiguous stamp time (rendered on the server, so always UTC). */
export function stampTime(date: Date): string {
  const d = date.toLocaleString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const t = date.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${d} ${t} UTC`;
}

export function Age({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} title={stampTime(date)} className="num text-xs" suppressHydrationWarning>
      {timeAgo(date)}
    </time>
  );
}
