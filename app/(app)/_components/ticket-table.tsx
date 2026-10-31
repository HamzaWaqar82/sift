import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { TicketListItem } from "@/lib/tickets";
import { hrefWith } from "../_lib/params";
import { Age, CategoryLabel, SourceLabel, StatusStamp, TicketNo, UrgencyTab } from "./ticket-labels";

/** Dense table view. Created sorts newest/oldest; Updated sorts by last update (the API's three sorts). */
export function TicketTable({ tickets, params }: { tickets: TicketListItem[]; params: Record<string, string> }) {
  const sort = params.sort ?? "newest";
  return (
    <div className="coupon max-h-[calc(100vh-13rem)] overflow-auto">
      <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
        <caption className="sr-only">Tickets. Column headers for Created and Updated change the sort.</caption>
        <thead className="sticky top-0 z-10 bg-panel-2 shadow-[0_1px_0_var(--color-rule)]">
          <tr className="border-b border-rule">
            <Th className="w-20">#</Th>
            <Th>Subject</Th>
            <Th>Customer</Th>
            <Th>Status</Th>
            <Th>Urgency</Th>
            <Th>Category</Th>
            <Th>Assignee</Th>
            <Th>Source</Th>
            <Th
              className="w-28"
              sort={sort === "newest" ? "descending" : sort === "oldest" ? "ascending" : undefined}
              href={hrefWith(params, { sort: sort === "newest" ? "oldest" : "newest" })}
            >
              Created
            </Th>
            <Th className="w-28" sort={sort === "updated" ? "descending" : undefined} href={hrefWith(params, { sort: "updated" })}>
              Updated
            </Th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className="group border-b border-rule-soft transition-colors duration-150 last:border-b-0 hover:bg-navy-hover">
              <td className="px-3 py-2">
                <TicketNo id={t.id} className="text-xs" />
              </td>
              <td className="max-w-[22rem] px-3 py-2">
                <Link href={`/tickets/${t.id}`} data-ticket-row className="block truncate font-medium text-ink hover:underline">
                  {t.subject}
                </Link>
              </td>
              <td className="max-w-[14rem] truncate px-3 py-2 text-ink-2" title={t.customerEmail}>
                {t.customerName ?? t.customerEmail}
              </td>
              <td className="px-3 py-2">
                <StatusStamp status={t.status} />
              </td>
              <td className="px-3 py-2">
                {t.triage?.ok ? <UrgencyTab urgency={t.triage.urgency} /> : <Dash label={t.triage ? "Triage failed" : "Not triaged"} />}
              </td>
              <td className="px-3 py-2">
                {t.triage?.ok ? <CategoryLabel category={t.triage.category} /> : <Dash label={t.triage ? "Triage failed" : "Not triaged"} />}
              </td>
              <td className={`whitespace-nowrap px-3 py-2 ${t.assignee ? "text-ink" : "text-ink-3"}`}>{t.assignee?.name ?? "Unassigned"}</td>
              <td className="px-3 py-2">
                <SourceLabel source={t.source} withIcon />
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <Age date={t.createdAt} />
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <Age date={t.updatedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dash({ label }: { label: string }) {
  return (
    <span className="text-xs text-ink-3" title={label}>
      <span aria-hidden="true">–</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Th({
  children,
  className = "",
  sort,
  href,
}: {
  children: React.ReactNode;
  className?: string;
  sort?: "ascending" | "descending";
  href?: string;
}) {
  const Icon = sort === "ascending" ? ArrowUp : sort === "descending" ? ArrowDown : ArrowUpDown;
  return (
    <th scope="col" aria-sort={href ? (sort ?? "none") : undefined} className={`px-3 py-2 ${className}`}>
      {href ? (
        <Link
          href={href}
          scroll={false}
          className={`inline-flex items-center gap-1 font-display text-xs font-semibold uppercase tracking-[0.08em] hover:text-ink ${
            sort ? "text-ink" : "text-ink-2"
          }`}
        >
          {children}
          <Icon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        </Link>
      ) : (
        <span className="font-display text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">{children}</span>
      )}
    </th>
  );
}
