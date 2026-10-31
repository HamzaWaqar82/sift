"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Plain text (line breaks kept) capped to a few lines so the draft and Send stay in the first
 * viewport; "Show full message" expands it. Short messages show no toggle.
 */
export function CappedText({ text, compact = false }: { text: string; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => {
      // Only meaningful while capped; when expanded the toggle stays so it can collapse again.
      if (!el.classList.contains("overflow-hidden")) return;
      setOverflows(el.scrollHeight > el.clientHeight + 2);
    };
    check();
    void document.fonts?.ready.then(check);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [text, open]);

  return (
    <div>
      <div
        ref={box}
        id="customer-message-text"
        className={`relative max-w-[72ch] whitespace-pre-wrap break-words text-ink ${open || !compact ? "" : "max-h-[6rem] overflow-hidden"}`}
      >
        {text}
        {!open && overflows && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-panel to-transparent" />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="customer-message-text"
          onClick={() => setOpen((o) => !o)}
          className="mt-2 inline-flex items-center gap-1 font-display text-xs font-semibold uppercase tracking-[0.08em] text-ink underline-offset-4 hover:underline"
        >
          {open ? <ChevronUp className="size-3.5" strokeWidth={1.5} aria-hidden="true" /> : <ChevronDown className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
          {open ? "Show less" : "Show full message"}
        </button>
      )}
    </div>
  );
}
