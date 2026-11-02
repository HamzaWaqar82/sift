import Link from "next/link";
import type { AiBudget } from "@/lib/triage";

function clock(d: Date): string {
  return d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

/**
 * Header chip: `AI 37/450 today · 3 queued`. Amber from 80% of the daily cap; while a limit
 * blocks every call it says when AI work resumes. Live events refresh it with the page.
 * Admins get a link to the AI panel.
 */
export function AiBudgetChip({ budget, href }: { budget: AiBudget; href?: string }) {
  const { used, cap, queued, nearCap, pausedUntil } = budget;
  const amber = nearCap || pausedUntil !== null;
  const content = (
    <>
      <span className="font-display text-xs font-semibold uppercase tracking-[0.08em]">AI</span>
      <span className="font-mono text-xs font-medium tabular-nums">
        {used}/{cap}
        <span className="hidden sm:inline"> today</span>
        {queued > 0 && <> · {queued} queued</>}
      </span>
      {pausedUntil && <span className="hidden text-xs md:inline">paused until {clock(pausedUntil)} UTC</span>}
    </>
  );
  const className = `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] px-2 transition-colors duration-150 ${
    amber ? "bg-warn-tint text-warn-ink" : "border border-white/30 text-band-ink hover:text-white"
  }`;
  const title = `${used} of ${cap} AI calls used today (UTC)${queued ? `, ${queued} waiting` : ""}${
    pausedUntil ? `. Paused until ${clock(pausedUntil)} UTC` : ""
  }`;
  return href ? (
    <Link href={href} className={className} title={title}>
      {content}
    </Link>
  ) : (
    <span className={className} title={title}>
      {content}
    </span>
  );
}
