import Link from "next/link";
import { LogOut, Plus } from "lucide-react";
import { Suspense } from "react";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { Wordmark } from "../_components/logo";
import { BandSearch } from "./_components/band-search";
import { InboxKeys } from "./_components/inbox-keys";
import { ViewTabs } from "./_components/view-tabs";

export const dynamic = "force-dynamic";

/** Signed-in shell: every page in this group requires a session. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 bg-panel px-3 py-2 text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Skip to content
      </a>
      <header className="band relative z-30 bg-ink text-white md:sticky md:top-0 md:h-14">
        <div aria-hidden="true" className="speed-stripe pointer-events-none absolute right-0 top-0 h-1.5 w-[46%] md:w-[34%]">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2 px-4 pt-2.5 lg:px-6">
          <Link href="/" className="order-1 mb-2.5 shrink-0 rounded-sm" aria-label="Sift, ticket inbox">
            <Wordmark tone="band" />
          </Link>
          <div className="order-4 w-full md:order-2 md:w-auto">
            <Suspense fallback={null}>
              <ViewTabs />
            </Suspense>
          </div>
          <div className="order-3 mb-1 w-full md:order-3 md:mb-2.5 md:ml-auto md:w-72 lg:w-80">
            <Suspense fallback={null}>
              <BandSearch />
            </Suspense>
          </div>
          <div className="order-2 mb-2.5 ml-auto flex items-center gap-2 sm:gap-3 md:order-4 md:ml-0">
            <Link
              href="/tickets/new"
              className="btn btn-sm border-white bg-transparent text-white hover:bg-white hover:text-ink"
            >
              <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
              <span className="hidden sm:inline">New ticket</span>
              <span className="sr-only sm:hidden">New ticket</span>
            </Link>
            <div className="flex items-center gap-2 border-l border-white/25 pl-3">
              <span
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-full border border-white/60 font-display text-xs font-semibold tracking-wider"
              >
                {initials}
              </span>
              <span className="hidden flex-col leading-tight lg:flex">
                <span className="text-sm font-medium">{user.name}</span>
                <span className="font-display text-2xs font-semibold uppercase tracking-[0.1em] text-band-ink">
                  {isAdmin(user) ? "Admin" : "Agent"}
                </span>
              </span>
              <span className="sr-only lg:hidden">
                Signed in as {user.name}, {isAdmin(user) ? "admin" : "agent"}
              </span>
              <form action="/api/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="grid size-8 place-items-center rounded-[var(--radius-control)] text-band-ink transition-colors duration-150 hover:bg-white/10 hover:text-white"
                  title="Sign out"
                >
                  <LogOut className="size-4" strokeWidth={1.5} aria-hidden="true" />
                  <span className="sr-only">Sign out</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>
      <InboxKeys />
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
