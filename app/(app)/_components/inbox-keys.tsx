"use client";

import { useEffect } from "react";

/**
 * Keyboard movement through the ticket list: j / k anywhere (when not typing), ↑ / ↓ while a row
 * has focus. Moving focuses the row's link; Enter opens it (native link behaviour).
 */
export function InboxKeys() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-ticket-row]")).filter((r) => r.offsetParent !== null);
      if (rows.length === 0) return;
      const onRow = t ? rows.indexOf(t) : -1;
      let dir = 0;
      if (e.key === "j") dir = 1;
      else if (e.key === "k") dir = -1;
      else if (onRow !== -1 && e.key === "ArrowDown") dir = 1;
      else if (onRow !== -1 && e.key === "ArrowUp") dir = -1;
      if (!dir) return;
      e.preventDefault();
      let from = onRow;
      if (from === -1) from = rows.findIndex((r) => r.getAttribute("aria-current") === "true");
      const next = from === -1 ? (dir > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, from + dir));
      rows[next].focus();
      rows[next].scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
