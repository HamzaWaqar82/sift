"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, CircleAlert, Ellipsis, Pin } from "lucide-react";
import { LABELS, PRESETS, sameState, viewState } from "../_lib/params";
import { useAnchoredPopover } from "./use-anchored-popover";

export type SavedViewRef = { id: number; name: string; params: Record<string, string> };

const NAME_MAX = 40; // VIEW_NAME_MAX on the server

function hrefFor(params: Record<string, string>, sv: string, view?: string): string {
  const q = new URLSearchParams(params);
  if (view && view !== "inbox" && !q.has("view")) q.set("view", view);
  if (q.get("view") === "inbox") q.delete("view");
  q.set("sv", sv);
  return `/?${q}`;
}

/** Human summary of a view's list state, for the save form and tooltips. */
function describe(state: Record<string, string>): string {
  const parts: string[] = [];
  const lbl = (group: keyof typeof LABELS, v: string) =>
    v
      .split(",")
      .map((x) => (LABELS[group] as Record<string, string>)[x] ?? x)
      .join(" or ");
  if (state.view) parts.push(`${state.view[0].toUpperCase()}${state.view.slice(1)} view`);
  if (state.status) parts.push(lbl("status", state.status));
  if (state.assignee) parts.push(state.assignee === "me" ? "Mine" : state.assignee === "unassigned" ? "Unassigned" : "One owner");
  if (state.urgency) parts.push(`${lbl("urgency", state.urgency)} urgency`);
  if (state.category) parts.push(lbl("category", state.category));
  if (state.source) parts.push(lbl("source", state.source));
  if (state.q) parts.push(`“${state.q}”`);
  if (state.sort) parts.push(lbl("sort", state.sort));
  if (state.limit) parts.push(`${state.limit} per page`);
  return parts.length ? parts.join(" · ") : "Every ticket, newest first";
}

/**
 * Notion-style views: pinned built-in presets, then the user's own saved views (stored per user
 * on the server), then "Save view". The active view is `?sv=` in the URL; with no `sv`, a preset
 * whose filters match the URL is shown as active.
 */
export function ViewsBar({ params, saved }: { params: Record<string, string>; saved: SavedViewRef[] }) {
  const view = params.view;
  const savedActive = params.sv ? saved.find((v) => String(v.id) === params.sv) : undefined;
  const presetActive = params.sv
    ? PRESETS.find((p) => p.key === params.sv && sameState(params, p.params))
    : PRESETS.find((p) => sameState(params, p.params));
  const activeKey = savedActive ? `s${savedActive.id}` : presetActive ? `p${presetActive.key}` : null;
  const savedMatch = !activeKey ? saved.find((v) => sameState(params, v.params) && (v.params.view ?? "inbox") === (view ?? "inbox")) : undefined;

  return (
    <nav aria-label="Saved views" className="z-20 h-11 border-b border-rule-soft bg-panel-2 md:sticky md:top-14">
      <ul className="flex h-full items-center gap-1 overflow-x-auto px-3 lg:px-6 [scrollbar-width:thin]">
        {PRESETS.map((p) => (
          <li key={p.key} className="shrink-0">
            <ViewLink href={hrefFor(p.params, p.key, view)} active={activeKey === `p${p.key}`} title={describe(p.params)}>
              <Pin className="size-3.5 -rotate-45" strokeWidth={1.5} aria-hidden="true" />
              {p.name}
            </ViewLink>
          </li>
        ))}
        {saved.length > 0 && <li aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-rule-soft" />}
        {saved.map((v) => (
          <li key={v.id} className="flex shrink-0 items-center">
            <ViewLink href={hrefFor(v.params, String(v.id))} active={activeKey === `s${v.id}` || savedMatch?.id === v.id} title={describe(v.params)}>
              <Bookmark className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              {v.name}
            </ViewLink>
            <ViewMenu view={v} params={params} active={activeKey === `s${v.id}`} />
          </li>
        ))}
        <li className="ml-auto shrink-0 pl-2">
          <SaveView params={params} unsaved={!activeKey && !savedMatch} count={saved.length} />
        </li>
      </ul>
    </nav>
  );
}

function ViewLink({ href, active, title, children }: { href: string; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] px-2.5 text-sm transition-colors duration-150 ${
        active ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-navy-hover hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function SaveView({ params, unsaved, count }: { params: Record<string, string>; unsaved: boolean; count: number }) {
  const router = useRouter();
  const id = useId().replace(/:/g, "");
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useAnchoredPopover(button, pop, "right");
  const state = viewState(params);
  const full = count >= 20;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the view a name");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, params: state }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setPending(false);
    if (!res?.ok || !json?.view) {
      setError(json?.fields?.name ?? json?.error ?? "Could not save the view. Try again.");
      return;
    }
    pop.current?.hidePopover();
    setName("");
    router.push(hrefFor(json.view.params, String(json.view.id)));
    router.refresh();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={`save-${id}`}
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] border border-ink px-2.5 font-display text-xs font-semibold uppercase tracking-[0.07em] text-ink transition-colors duration-150 hover:bg-ink hover:text-white"
      >
        <BookmarkPlus className="size-4" strokeWidth={1.5} aria-hidden="true" />
        Save view
        {unsaved && <span className="size-1.5 rounded-full bg-jet" aria-label="(current filters are not saved)" />}
      </button>
      <div ref={pop} id={`save-${id}`} popover="auto" className="pop w-80" aria-label="Save current view">
        <form onSubmit={save} className="space-y-3 p-3">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.08em] text-ink">Save current view</p>
          <p className="text-sm text-ink-2">{describe(state)}</p>
          {full ? (
            <p className="text-sm text-jet-ink">You have 20 saved views, the most allowed. Delete one to save another.</p>
          ) : (
            <>
              <div>
                <label htmlFor={`name-${id}`} className="label">
                  Name
                </label>
                <input
                  id={`name-${id}`}
                  value={name}
                  maxLength={NAME_MAX}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. Billing, oldest first"
                  aria-invalid={!!error || undefined}
                  className="input"
                />
                <div className="mt-1 flex justify-between gap-2 text-xs">
                  <span className="text-jet-ink" role={error ? "alert" : undefined}>
                    {error && (
                      <span className="inline-flex items-center gap-1">
                        <CircleAlert className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                        {error}
                      </span>
                    )}
                  </span>
                  <span className="num">
                    {name.trim().length}/{NAME_MAX}
                  </span>
                </div>
              </div>
              <button type="submit" disabled={pending} className="btn btn-sm btn-navy w-full">
                {pending ? "Saving…" : "Save view"}
              </button>
            </>
          )}
        </form>
      </div>
    </>
  );
}

function ViewMenu({ view, params, active }: { view: SavedViewRef; params: Record<string, string>; active: boolean }) {
  const router = useRouter();
  const id = useId().replace(/:/g, "");
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(view.name);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useAnchoredPopover(button, pop);

  async function call(method: "PATCH" | "DELETE") {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/views/${view.id}`, {
      method,
      headers: method === "PATCH" ? { "content-type": "application/json" } : undefined,
      body: method === "PATCH" ? JSON.stringify({ name }) : undefined,
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setPending(false);
    if (!res?.ok) {
      setError(json?.fields?.name ?? json?.error ?? "Could not update the view.");
      return;
    }
    pop.current?.hidePopover();
    if (method === "DELETE" && active) {
      const q = new URLSearchParams(params);
      q.delete("sv");
      router.push(q.size ? `/?${q}` : "/");
    }
    router.refresh();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={`menu-${id}`}
        className="grid size-7 place-items-center rounded-[var(--radius-control)] text-ink-2 hover:bg-navy-hover hover:text-ink"
      >
        <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden="true" />
        <span className="sr-only">Rename or delete {view.name}</span>
      </button>
      <div ref={pop} id={`menu-${id}`} popover="auto" className="pop w-72" aria-label={`Edit view ${view.name}`}>
        <form
          className="space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void call("PATCH");
          }}
        >
          <label htmlFor={`rename-${id}`} className="label">
            Rename view
          </label>
          <div className="flex gap-2">
            <input
              id={`rename-${id}`}
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error || undefined}
              className="input min-h-0 py-1.5 text-sm"
            />
            <button type="submit" disabled={pending || !name.trim() || name.trim() === view.name} className="btn btn-sm">
              Save
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-jet-ink">
              {error}
            </p>
          )}
        </form>
        <div className="border-t border-rule-soft p-3">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1 text-ink-2">Delete “{view.name}”? Its tickets are not affected.</span>
              <button type="button" className="btn btn-sm border-jet-ink text-jet-ink hover:bg-jet-ink hover:text-white" onClick={() => call("DELETE")} disabled={pending}>
                Delete
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="link text-sm text-jet-ink" onClick={() => setConfirming(true)}>
              Delete view…
            </button>
          )}
        </div>
      </div>
    </>
  );
}
