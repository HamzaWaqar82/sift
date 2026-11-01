"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { ArrowDownUp, Check, ChevronDown, X } from "lucide-react";
import { hrefWith, LABELS } from "../_lib/params";

type Counts = { total: number; byStatus: Record<string, number> } | null;
type User = { id: number; name: string };
type Option = { value: string; label: string };

const STATUS_TABS: { value: string | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "open", label: "Open" },
  { value: "replied", label: "Replied" },
  { value: "closed", label: "Closed" },
];

const FILTER_KEYS = ["q", "overdue", "assignee", "urgency", "category", "source"] as const;

/**
 * Status tabs with live counts, filter popovers (assignee, urgency, category, source, sort),
 * removable chips for every active filter, and the match count.
 */
export function FilterRail({
  params,
  counts,
  users,
  meId,
}: {
  params: Record<string, string>;
  counts: Counts;
  users: User[];
  meId: number;
}) {
  const status = params.status ?? null;
  const assigneeOptions: Option[] = [
    { value: "me", label: "Me" },
    { value: "unassigned", label: "Unassigned" },
    ...users.filter((u) => u.id !== meId).map((u) => ({ value: String(u.id), label: u.name })),
  ];
  const urgencyOptions = Object.entries(LABELS.urgency).map(([value, label]) => ({ value, label }));
  const categoryOptions = Object.entries(LABELS.category).map(([value, label]) => ({ value, label }));
  const sourceOptions = Object.entries(LABELS.source).map(([value, label]) => ({ value, label }));
  const sortOptions = Object.entries(LABELS.sort).map(([value, label]) => ({ value, label }));

  const chips: { key: string; label: string; href: string }[] = [];
  if (params.q) chips.push({ key: "q", label: `“${params.q}”`, href: hrefWith(params, { q: null }) });
  if (params.overdue) chips.push({ key: "overdue", label: "Overdue", href: hrefWith(params, { overdue: null }) });
  if (params.assignee) {
    const label = assigneeOptions.find((o) => o.value === params.assignee)?.label ?? (Number(params.assignee) === meId ? "Me" : `User ${params.assignee}`);
    chips.push({ key: "assignee", label: `Owner: ${label}`, href: hrefWith(params, { assignee: null }) });
  }
  for (const key of ["urgency", "category"] as const) {
    const values = params[key]?.split(",").filter(Boolean) ?? [];
    const labels = LABELS[key] as Record<string, string>;
    for (const v of values) {
      const rest = values.filter((x) => x !== v).join(",");
      chips.push({ key: `${key}-${v}`, label: `${key === "urgency" ? "Urgency" : "Category"}: ${labels[v] ?? v}`, href: hrefWith(params, { [key]: rest || null }) });
    }
  }
  if (params.source) {
    chips.push({ key: "source", label: `Source: ${(LABELS.source as Record<string, string>)[params.source] ?? params.source}`, href: hrefWith(params, { source: null }) });
  }
  const filtered = FILTER_KEYS.some((k) => params[k]);
  const clearAll = hrefWith(params, Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  const matchCount = counts ? (status ? status.split(",").reduce((a, s) => a + (counts.byStatus[s] ?? 0), 0) : counts.total) : null;

  return (
    <div className="space-y-3">
      <nav aria-label="Filter by status" className="flex items-end gap-1 border-b border-rule">
        {STATUS_TABS.map((t) => {
          const active = status === t.value;
          const n = counts ? (t.value ? counts.byStatus[t.value] : counts.total) : null;
          return (
            <Link
              key={t.label}
              href={hrefWith(params, { status: t.value })}
              aria-current={active ? "page" : undefined}
              data-tone={active ? "navy" : undefined}
              className={`tab h-8 px-3 ${active ? "" : "text-ink-2 hover:text-ink"}`}
              style={active ? undefined : ({ "--tab-fill": "var(--color-ground)", "--tab-line": "var(--color-rule-soft)" } as React.CSSProperties)}
            >
              {t.label}
              {n !== null && (
                <span className={`font-mono text-2xs tabular-nums ${active ? "text-white" : "text-carbon"}`}>{n}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterMenu label="Owner" paramKey="assignee" params={params} options={assigneeOptions} />
        <FilterMenu label="Urgency" paramKey="urgency" params={params} options={urgencyOptions} multi />
        <FilterMenu label="Category" paramKey="category" params={params} options={categoryOptions} multi />
        <FilterMenu label="Source" paramKey="source" params={params} options={sourceOptions} />
        <FilterMenu label="Sort" paramKey="sort" params={params} options={sortOptions} icon defaultValue="newest" />
      </div>

      {filtered && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters" role="group">
          {chips.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              className="group inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-ink bg-navy-tint pl-2 pr-1 text-xs font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-white"
            >
              {c.label}
              <X className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              <span className="sr-only">(remove filter)</span>
            </Link>
          ))}
          <Link href={clearAll} className="link ml-1 text-xs">
            Clear all
          </Link>
          {matchCount !== null && (
            <p className="ml-auto text-xs text-ink-2" aria-live="polite">
              <span className="num font-medium">{matchCount}</span> {matchCount === 1 ? "match" : "matches"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FilterMenu({
  label,
  paramKey,
  params,
  options,
  multi = false,
  icon = false,
  defaultValue,
}: {
  label: string;
  paramKey: string;
  params: Record<string, string>;
  options: Option[];
  multi?: boolean;
  icon?: boolean;
  defaultValue?: string;
}) {
  const router = useRouter();
  const id = useId().replace(/:/g, "");
  const popId = `pop-${id}`;
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const raw = params[paramKey] ?? defaultValue ?? "";
  const selected = multi ? raw.split(",").filter(Boolean) : raw ? [raw] : [];
  const active = selected.length > 0 && !(defaultValue && raw === defaultValue);
  const summary = active
    ? multi && selected.length > 1
      ? `${selected.length}`
      : options.find((o) => o.value === selected[0])?.label
    : defaultValue
      ? options.find((o) => o.value === defaultValue)?.label
      : null;

  // Position the top-layer popover under its button (it never gets clipped by scroll panes).
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    function place(e: Event) {
      if ((e as ToggleEvent).newState !== "open" || !button.current || !el) return;
      const r = button.current.getBoundingClientRect();
      const width = Math.max(208, el.offsetWidth);
      el.style.top = `${Math.round(r.bottom + 4)}px`;
      el.style.left = `${Math.round(Math.min(r.left, window.innerWidth - width - 8))}px`;
      requestAnimationFrame(() => el.querySelector<HTMLElement>("[aria-pressed='true'], button")?.focus());
    }
    el.addEventListener("beforetoggle", place);
    el.addEventListener("toggle", place);
    return () => {
      el.removeEventListener("beforetoggle", place);
      el.removeEventListener("toggle", place);
    };
  }, []);

  function choose(value: string) {
    let next: string | null;
    if (multi) {
      const set = new Set(selected);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      next = [...set].join(",") || null;
    } else {
      next = raw === value && !defaultValue ? null : value;
      pop.current?.hidePopover();
      button.current?.focus();
    }
    router.push(hrefWith(params, { [paramKey]: next }), { scroll: false });
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={popId}
        aria-haspopup="true"
        className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-sm transition-colors duration-150 ${
          active ? "border-ink bg-ink text-white hover:bg-[#1c2d5a]" : "border-rule-soft bg-panel text-ink hover:border-ink"
        }`}
      >
        {icon && <ArrowDownUp className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
        <span className="font-display text-xs font-semibold uppercase tracking-[0.07em]">{label}</span>
        {summary && <span className={`max-w-[9rem] truncate text-xs ${active ? "text-white" : "text-ink-2"}`}>{summary}</span>}
        <ChevronDown className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <div ref={pop} id={popId} popover="auto" className="pop" aria-label={`${label} filter`} role="group">
        <div className="border-b border-rule-soft px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
          {multi ? `${label}: pick any` : label}
        </div>
        <ul className="py-1">
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => choose(o.value)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-navy-hover focus-visible:bg-navy-hover focus-visible:outline-offset-[-2px] ${
                    on ? "font-medium text-ink" : "text-ink-2"
                  }`}
                >
                  <span
                    className={`grid size-4 place-items-center border ${multi ? "rounded-[2px]" : "rounded-full"} ${
                      on ? "border-ink bg-ink text-white" : "border-ink-3"
                    }`}
                    aria-hidden="true"
                  >
                    {on && <Check className="size-3" strokeWidth={2} />}
                  </span>
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
        {multi && selected.length > 0 && (
          <div className="border-t border-rule-soft px-3 py-2">
            <button
              type="button"
              className="link text-xs"
              onClick={() => {
                pop.current?.hidePopover();
                router.push(hrefWith(params, { [paramKey]: null }), { scroll: false });
              }}
            >
              Clear {label.toLowerCase()}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
