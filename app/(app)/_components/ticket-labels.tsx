import type { TicketSource, TicketStatus } from "@/lib/db/schema";
import type { TriageSummary } from "@/lib/tickets";

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-amber-100 text-amber-800",
  replied: "bg-sky-100 text-sky-800",
  closed: "bg-slate-200 text-slate-700",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

export function SourceLabel({ source }: { source: TicketSource }) {
  return <span className="text-xs text-slate-500">{source === "webhook" ? "Email" : "Form"}</span>;
}

const URGENCY_BADGE_STYLES = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800 font-semibold",
};

/** Category and urgency badges for tickets whose latest triage is valid; a clear marker otherwise. */
export function TriageMarker({ triage }: { triage: TriageSummary }) {
  if (!triage) {
    return <span className="text-xs italic text-slate-400">Not triaged yet</span>;
  }
  if (!triage.ok) {
    return <span className="text-xs text-red-600">Triage failed</span>;
  }
  return (
    <span className="mt-1 flex flex-wrap gap-1 text-xs">
      <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium capitalize text-indigo-800">
        {triage.category.replace("_", " ")}
      </span>
      <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${URGENCY_BADGE_STYLES[triage.urgency]}`}>
        {triage.urgency} urgency
      </span>
    </span>
  );
}

/** "5m ago", "3h ago", "4d ago", then a date. */
export function timeAgo(date: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return date.toISOString().slice(0, 10);
}
