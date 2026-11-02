import Link from "next/link";
import type { TicketListItem } from "@/lib/tickets";
import { hrefWith } from "../_lib/params";
import { Age, OverdueBadge, StatusStamp, TicketNo, TriageMarker } from "./ticket-labels";

/**
 * The wallet: one small coupon per ticket. Stub at left (number + age), perforation, then the
 * subject, customer and owner, with urgency, category and status along the bottom rule.
 */
export function InboxList({
  tickets,
  params,
  selectedId,
  explicitId,
}: {
  tickets: TicketListItem[];
  params: Record<string, string>;
  selectedId: number | null;
  explicitId: number | null;
}) {
  return (
    <ol className="space-y-1.5 px-3 pb-3 lg:px-4" aria-label="Tickets (j / k to move, Enter to open)">
      {tickets.map((t) => {
        // explicit: this ticket is open in the pane. implicit: nothing chosen, so the desktop pane
        // shows the first ticket; narrow screens show no pane, so no highlight there.
        const explicit = explicitId === t.id;
        const implicit = explicitId === null && t.id === selectedId;
        const row = explicit
          ? "border-ink bg-navy-tint shadow-[var(--shadow-coupon)]"
          : implicit
            ? "border-rule-soft bg-panel hover:border-ink hover:bg-navy-hover md:border-ink md:bg-navy-tint md:shadow-[var(--shadow-coupon)]"
            : "border-rule-soft bg-panel hover:border-ink hover:bg-navy-hover";
        const stub = explicit
          ? "border-white/40 bg-ink [&_.num]:!text-white"
          : implicit
            ? "border-ink-3 bg-panel-2 md:border-white/40 md:bg-ink md:[&_.num]:!text-white"
            : "border-ink-3 bg-panel-2";
        return (
          <li key={t.id} data-ticket-id={t.id}>
            <Link
              href={hrefWith(params, { ticket: String(t.id) })}
              scroll={false}
              data-ticket-row
              aria-current={explicit || implicit ? "true" : undefined}
              className={`group grid grid-cols-[4rem_1fr] overflow-hidden rounded-[var(--radius-coupon)] border transition-colors duration-150 focus-visible:outline-offset-1 ${row}`}
            >
              <div className={`flex flex-col items-start justify-between gap-1 border-r border-dashed px-2 py-1.5 ${stub}`}>
                <TicketNo id={t.id} className="text-xs font-medium" />
                <Age date={t.createdAt} />
              </div>
              <div className="min-w-0 px-3 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1.5">
                    <OverdueBadge since={t.overdueWaitingSince} />
                    <span className="min-w-0 truncate font-medium leading-snug text-ink">{t.subject}</span>
                  </p>
                  <StatusStamp status={t.status} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="flex min-w-0 gap-1.5 text-sm text-ink-2">
                    <span className="truncate" title={t.customerEmail}>
                      {t.customerName ?? t.customerEmail}
                    </span>
                    <span aria-hidden="true" className="text-ink-3">
                      /
                    </span>
                    <span className={`shrink-0 ${t.assignee ? "" : "text-ink-3"}`}>{t.assignee?.name ?? "Unassigned"}</span>
                  </p>
                  <span className="shrink-0">
                    <TriageMarker triage={t.triage} />
                  </span>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
