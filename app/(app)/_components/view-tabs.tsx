"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Columns3, Inbox, Table2 } from "lucide-react";
import { hrefWith, viewOf, type View } from "../_lib/params";

const TABS: { view: View; label: string; Icon: typeof Inbox }[] = [
  { view: "inbox", label: "Inbox", Icon: Inbox },
  { view: "table", label: "Table", Icon: Table2 },
  { view: "board", label: "Board", Icon: Columns3 },
];

/** View tabs on the navy band. Their shape joins the stock-white page below, like a wallet folder. */
export function ViewTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const onList = pathname === "/";
  const current = Object.fromEntries(sp.entries());
  const active = onList ? viewOf(current) : null;

  return (
    <nav aria-label="Ticket views" className="flex items-end gap-1">
      {TABS.map(({ view, label, Icon }) => {
        const isActive = active === view;
        const href = onList ? hrefWith(current, { view, ticket: null }) : view === "inbox" ? "/" : `/?view=${view}`;
        return (
          <Link
            key={view}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`tab h-9 px-4 text-sm transition-colors duration-150 ${
              isActive ? "text-ink" : "text-band-ink hover:text-white"
            }`}
            data-tone={isActive ? "ground" : "band"}
          >
            <Icon className="size-4" strokeWidth={1.5} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
