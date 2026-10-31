"use client";

import { useEffect, type RefObject } from "react";

/**
 * Places a native top-layer popover under its anchor button when it opens (so it is never clipped
 * by a scroll pane) and focuses its first control. On narrow screens CSS turns `.pop` into a
 * bottom sheet instead, and these coordinates are ignored.
 */
export function useAnchoredPopover(anchor: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>, align: "left" | "right" = "left") {
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    function place(e: Event) {
      if ((e as ToggleEvent).newState !== "open" || !anchor.current || !el) return;
      const r = anchor.current.getBoundingClientRect();
      const width = Math.max(224, el.offsetWidth);
      const left = align === "right" ? r.right - width : r.left;
      el.style.top = `${Math.round(r.bottom + 4)}px`;
      el.style.left = `${Math.round(Math.max(8, Math.min(left, window.innerWidth - width - 8)))}px`;
      requestAnimationFrame(() => el.querySelector<HTMLElement>("input, [aria-pressed='true'], button")?.focus());
    }
    el.addEventListener("beforetoggle", place);
    el.addEventListener("toggle", place);
    return () => {
      el.removeEventListener("beforetoggle", place);
      el.removeEventListener("toggle", place);
    };
  }, [anchor, pop, align]);
}
