"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { hrefWith } from "../_lib/params";

const MAX = 100; // SEARCH_MAX_LENGTH on the server

/**
 * The one ticket search. On the list it filters as you type (debounced, synced to ?q=);
 * elsewhere Enter takes you to the list with the search applied. "/" focuses it.
 */
export function BandSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlQ = sp.get("q") ?? "";
  const [value, setValue] = useState(urlQ);
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onList = pathname === "/";

  // The URL changed from elsewhere (Clear all, a chip, back button): follow it.
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    setValue(urlQ);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function apply(q: string, immediate = false) {
    if (timer.current) clearTimeout(timer.current);
    const go = () => {
      const current = Object.fromEntries(new URLSearchParams(window.location.search).entries());
      if ((current.q ?? "") === q.trim()) return;
      router.replace(hrefWith(current, { q: q.trim() || null }), { scroll: false });
    };
    if (immediate) go();
    else timer.current = setTimeout(go, 300);
  }

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        if (onList) apply(value, true);
        else router.push(value.trim() ? `/?q=${encodeURIComponent(value.trim())}` : "/");
      }}
    >
      <label htmlFor="ticket-search" className="sr-only">
        Search tickets
      </label>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-band-ink"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <input
        ref={input}
        id="ticket-search"
        type="search"
        value={value}
        maxLength={MAX}
        autoComplete="off"
        placeholder="Search subject, message, customer"
        aria-keyshortcuts="/"
        onChange={(e) => {
          setValue(e.target.value);
          if (onList) apply(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) {
              setValue("");
              if (onList) apply("", true);
            } else {
              input.current?.blur();
            }
          }
        }}
        className="h-9 w-full rounded-[var(--radius-control)] border border-[#3a4a75] bg-[#16264d] pl-8 pr-14 text-sm text-white transition-colors duration-150 placeholder:text-band-ink hover:border-band-ink focus:border-white focus:shadow-[0_0_0_1px_#fff] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            if (onList) apply("", true);
            input.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-band-ink hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only">Clear search</span>
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-[#3a4a75] px-1.5 font-mono text-2xs text-band-ink"
        >
          /
        </kbd>
      )}
    </form>
  );
}
