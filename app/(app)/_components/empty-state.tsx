import Link from "next/link";
import { FilterX, Inbox, TriangleAlert } from "lucide-react";
import { DEFAULT_PRESET, hrefWith, LABELS, PRESETS, sameState } from "../_lib/params";

const FILTER_KEYS = ["q", "status", "assignee", "urgency", "category", "source"] as const;

function describe(params: Record<string, string>): string[] {
  const out: string[] = [];
  if (params.q) out.push(`matching “${params.q}”`);
  if (params.status) out.push(`with status ${params.status.split(",").map((s) => (LABELS.status as Record<string, string>)[s] ?? s).join(" or ")}`);
  if (params.assignee) out.push(params.assignee === "me" ? "assigned to you" : params.assignee === "unassigned" ? "unassigned" : "with the chosen owner");
  if (params.urgency) out.push(`with ${params.urgency.split(",").map((s) => (LABELS.urgency as Record<string, string>)[s] ?? s).join(" or ")} urgency`);
  if (params.category) out.push(`in ${params.category.split(",").map((s) => (LABELS.category as Record<string, string>)[s] ?? s).join(" or ")}`);
  if (params.source) out.push(`from ${(LABELS.source as Record<string, string>)[params.source] ?? params.source}`);
  return out;
}

/** Empty states that teach: no tickets at all vs. no matches for the active filters. */
export function EmptyState({ params, paged }: { params: Record<string, string>; paged: boolean }) {
  const active = FILTER_KEYS.some((k) => params[k]);
  if (paged) {
    return (
      <Shell icon={<Inbox className="size-6" strokeWidth={1.5} aria-hidden="true" />} title="End of the list">
        <p>There are no more tickets after this page.</p>
        <Link href={hrefWith(params, { cursor: null, trail: null })} className="btn btn-sm mt-4">
          Back to the first page
        </Link>
      </Shell>
    );
  }
  if (params.sv === "mine" && sameState(params, DEFAULT_PRESET.params)) {
    const needsOwner = PRESETS.find((p) => p.key === "needs-owner")!;
    return (
      <Shell icon={<Inbox className="size-6" strokeWidth={1.5} aria-hidden="true" />} title="Nothing on your desk">
        <p>No open tickets are assigned to you. Pick one up from the pool.</p>
        <Link href={hrefWith(params, { ...needsOwner.params, sv: needsOwner.key })} className="btn btn-sm mt-4">
          Needs an owner
        </Link>
      </Shell>
    );
  }
  if (active) {
    const parts = describe(params);
    return (
      <Shell icon={<FilterX className="size-6" strokeWidth={1.5} aria-hidden="true" />} title="No tickets match">
        <p>
          No tickets {parts.join(", ")}.
        </p>
        <Link href={hrefWith(params, Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))} className="btn btn-sm mt-4">
          Clear all filters
        </Link>
      </Shell>
    );
  }
  return (
    <Shell icon={<Inbox className="size-6" strokeWidth={1.5} aria-hidden="true" />} title="The wallet is empty">
      <p>Customer email lands here. Log phone and chat tickets yourself.</p>
      <Link href="/tickets/new" className="btn btn-sm btn-navy mt-4">
        Log a ticket
      </Link>
    </Shell>
  );
}

/** The inbox's right pane when there is nothing to open. */
export function NoTicketSelected({ params }: { params: Record<string, string> }) {
  const active = FILTER_KEYS.some((k) => params[k]);
  return (
    <div className="coupon-quiet p-6 text-sm text-ink-2">
      <h2 className="caps-bold text-lg text-ink">No ticket selected</h2>
      {active ? (
        <>
          <p className="mt-1">No tickets match these filters.</p>
          <Link href={hrefWith(params, Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))} className="btn btn-sm mt-4">
            Clear all filters
          </Link>
        </>
      ) : (
        <p className="mt-1">Pick a ticket from the list.</p>
      )}
    </div>
  );
}

export function ExpiredPage({ href }: { href: string }) {
  return (
    <Shell icon={<TriangleAlert className="size-6" strokeWidth={1.5} aria-hidden="true" />} title="That page link has expired">
      <p>The list changed since this link was made (or the sort changed). Start again from the first page.</p>
      <Link href={href} className="btn btn-sm mt-4">
        First page
      </Link>
    </Shell>
  );
}

export function InvalidQuery({ fields }: { fields: Record<string, string> }) {
  return (
    <Shell icon={<TriangleAlert className="size-6" strokeWidth={1.5} aria-hidden="true" />} title="These filters are not valid">
      <ul className="space-y-1">
        {Object.entries(fields).map(([k, v]) => (
          <li key={k}>{v}</li>
        ))}
      </ul>
      <Link href="/?sv=all" className="btn btn-sm mt-4">
        Show every ticket
      </Link>
    </Shell>
  );
}

function Shell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-3 my-2 flex flex-col items-center rounded-[var(--radius-coupon)] border border-dashed border-ink-3 bg-panel px-6 py-10 text-center text-sm text-ink-2 lg:mx-4">
      <div className="mb-3 grid size-11 place-items-center rounded-full border border-ink text-ink">{icon}</div>
      <h2 className="caps-bold mb-2 text-lg text-ink">{title}</h2>
      <div className="max-w-sm">{children}</div>
    </div>
  );
}
