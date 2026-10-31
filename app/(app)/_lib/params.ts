// The ticket views' URL state. Every view, filter, sort, page size and page position lives in
// the query string, so a view is shareable and the browser back button works.

export const VIEWS = ["inbox", "table", "board"] as const;
export type View = (typeof VIEWS)[number];

export const PAGE_SIZES = [20, 50, 100] as const;

/** Query keys that change which tickets match; changing any of them resets paging. */
export const FILTER_KEYS = ["q", "status", "assignee", "category", "urgency", "source"] as const;
/** Keys a saved view captures besides the view type. */
export const VIEW_STATE_KEYS = [...FILTER_KEYS, "sort", "limit"] as const;
/** Keys that describe the page position (cursor + the trail of earlier cursors for Previous). */
const PAGE_KEYS = ["cursor", "trail"] as const;

export type RawParams = Record<string, string | string[] | undefined>;

/** First string value of each param, empty strings dropped. */
export function flatParams(sp: RawParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s !== "") out[k] = s;
  }
  return out;
}

export function viewOf(p: Record<string, string>): View {
  return (VIEWS as readonly string[]).includes(p.view) ? (p.view as View) : "inbox";
}

export function pageSizeOf(p: Record<string, string>): number {
  const n = Number(p.limit);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : 20;
}

/**
 * Builds "/?..." from the current params plus changes (null deletes a key). Changing a filter,
 * the sort, the page size or the view resets the page position.
 */
export function hrefWith(current: Record<string, string>, changes: Record<string, string | null | undefined>): string {
  const next = new URLSearchParams();
  const resetsPaging = Object.keys(changes).some((k) => !(PAGE_KEYS as readonly string[]).includes(k) && k !== "ticket");
  for (const [k, v] of Object.entries(current)) {
    if (resetsPaging && (PAGE_KEYS as readonly string[]).includes(k)) continue;
    next.set(k, v);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === "") next.delete(k);
    else next.set(k, v);
  }
  // Editing filters, sort or page size leaves the active saved/preset view ("sv").
  if (!("sv" in changes) && Object.keys(changes).some((k) => (VIEW_STATE_KEYS as readonly string[]).includes(k))) next.delete("sv");
  // Defaults stay out of the URL.
  if (next.get("view") === "inbox") next.delete("view");
  if (next.get("sort") === "newest") next.delete("sort");
  if (next.get("limit") === "20") next.delete("limit");
  const qs = next.toString();
  return qs ? `/?${qs}` : "/";
}

/** The query string for the list APIs / lib calls (filters + sort + limit), without view state. */
export function apiParams(p: Record<string, string>, extra: Record<string, string> = {}): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of [...FILTER_KEYS, "sort"]) if (p[k]) out.set(k, p[k]);
  for (const [k, v] of Object.entries(extra)) out.set(k, v);
  return out;
}

/** Previous-page cursors, oldest first. "_" stands for the first page (no cursor). */
export function trailOf(p: Record<string, string>): string[] {
  return p.trail ? p.trail.split(".").filter(Boolean) : [];
}

export const LABELS = {
  status: { open: "Open", replied: "Replied", closed: "Closed" },
  urgency: { high: "High", medium: "Medium", low: "Low" },
  category: {
    billing: "Billing",
    technical: "Technical",
    account: "Account",
    feature_request: "Feature request",
    other: "Other",
  },
  source: { webhook: "Email", form: "Form" },
  sort: { newest: "Newest first", oldest: "Oldest first", updated: "Recently updated" },
} as const;

/** Built-in views, pinned before the user's own. They keep the current view type. */
export const PRESETS: { key: string; name: string; params: Record<string, string> }[] = [
  { key: "all", name: "All tickets", params: {} },
  { key: "needs-reply", name: "Needs reply", params: { status: "open" } },
  { key: "my-open", name: "My open", params: { assignee: "me", status: "open" } },
  { key: "unassigned", name: "Unassigned", params: { assignee: "unassigned", status: "open" } },
  { key: "high", name: "High urgency", params: { urgency: "high", status: "open" } },
];

/** The list state a view would save: view type plus filters, sort and page size. */
export function viewState(p: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["view", ...VIEW_STATE_KEYS]) if (p[k]) out[k] = p[k];
  return out;
}

/** True when the current filters/sort/limit are exactly these view params (view type ignored). */
export function sameState(p: Record<string, string>, params: Record<string, string>): boolean {
  return VIEW_STATE_KEYS.every((k) => (p[k] ?? "") === (params[k] ?? ""));
}
