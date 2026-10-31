"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import { hrefWith, PAGE_SIZES } from "../_lib/params";

export function PageSizeSelect({ params, size }: { params: Record<string, string>; size: number }) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="font-display text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        Per page
      </label>
      <select
        id={id}
        value={size}
        onChange={(e) => router.push(hrefWith(params, { limit: e.target.value }), { scroll: false })}
        className="h-[1.875rem] rounded-[var(--radius-control)] border border-ink-3 bg-panel px-1.5 font-mono text-xs text-carbon hover:border-ink"
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}
