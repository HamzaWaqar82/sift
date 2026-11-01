"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav({ sections }: { sections: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="mb-4 mt-2 flex gap-4 border-b border-rule-soft">
      {sections.map((s) => {
        const current = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px border-b-2 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.08em] ${
              current ? "border-jet text-ink" : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
