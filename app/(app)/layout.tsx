import Link from "next/link";
import { LogOut, Plus, ShieldCheck } from "lucide-react";
import { Suspense } from "react";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { overdueCount } from "@/lib/tickets/overdue";
import { aiBudget } from "@/lib/triage";
import { listTeamPresence } from "@/lib/users/availability";
import { AiBudgetChip } from "./_components/ai-budget-chip";
import { BandHeight } from "./_components/band-height";
import { Wordmark } from "../_components/logo";
import { BandSearch } from "./_components/band-search";
import { InboxKeys } from "./_components/inbox-keys";
import { LiveStatusChip, LiveUpdates } from "./_components/live-updates";
import { PresenceMenu } from "./_components/presence-menu";
import { ViewTabs } from "./_components/view-tabs";

export const dynamic = "force-dynamic";

/** Jet-age speed stripe: three white dashes then a jet red bar, along the band's top edge. */
function SpeedStripe() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-speed-stripe
      viewBox="0 0 340 6"
      preserveAspectRatio="none"
      className="pointer-events-none absolute right-0 top-0 z-10 block h-1.5 w-[46%] md:w-[34%]"
    >
      <polygon points="5,0 15,0 11,6 1,6" fill="#ffffff" />
      <polygon points="23,0 33,0 29,6 19,6" fill="#ffffff" />
      <polygon points="41,0 51,0 47,6 37,6" fill="#ffffff" />
      <polygon points="59,0 340,0 340,6 55,6" fill="#d7262d" />
    </svg>
  );
}

/** Signed-in shell: every page in this group requires a session. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [overdue, budget, team] = await Promise.all([overdueCount(), aiBudget(), listTeamPresence()]);
  const role = isAdmin(user) ? "admin" : "agent";
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <LiveUpdates userId={user.id}>
      <div className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only z-50 bg-panel px-3 py-2 text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
        >
          Skip to content
        </a>
        <header id="band" className="band relative z-30 bg-ink text-white md:sticky md:top-0">
          <SpeedStripe />
          <BandHeight />
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2 px-4 pt-2.5 lg:px-6">
            <Link href="/" className="order-1 mb-2.5 shrink-0 rounded-sm" aria-label="Sift, ticket inbox">
              <Wordmark tone="band" />
            </Link>
            {/* One row from xl up; below it the status cluster sits beside the wordmark and the tabs drop to a second row. */}
            <div aria-hidden="true" className="order-3 hidden h-0 basis-full md:block xl:hidden" />
            <div className="order-4 w-full md:w-auto xl:order-2">
              <Suspense fallback={null}>
                <ViewTabs />
              </Suspense>
            </div>
            <div className="order-3 mb-1 w-full md:order-5 md:mb-2.5 md:ml-auto md:w-72 lg:w-80 xl:order-3">
              <Suspense fallback={null}>
                <BandSearch />
              </Suspense>
            </div>
            <div className="order-2 mb-2.5 ml-auto flex flex-wrap items-center justify-end gap-2 xl:order-4 xl:ml-0">
              <LiveStatusChip />
              <PresenceMenu meId={user.id} team={team} admin={isAdmin(user)} />
              <AiBudgetChip budget={budget} href={isAdmin(user) ? "/admin/ai" : undefined} />
              {overdue > 0 && (
                <Link
                  href="/?overdue=1"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-overdue px-2 text-ink transition-colors duration-150 hover:bg-white"
                  title={`${overdue} overdue ${overdue === 1 ? "ticket" : "tickets"}: show them`}
                >
                  <span className="font-display text-xs font-semibold uppercase tracking-[0.08em]">Overdue</span>
                  <span className="font-mono text-xs font-medium tabular-nums">{overdue}</span>
                </Link>
              )}
              {isAdmin(user) && (
                <Link
                  href="/admin"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-band-ink transition-colors duration-150 hover:bg-white/10 hover:text-white"
                  title="Admin: users, audit log and AI"
                >
                  <ShieldCheck className="size-4" strokeWidth={1.5} aria-hidden="true" />
                  <span className="hidden font-display text-xs font-semibold uppercase tracking-[0.08em] 2xl:inline">Admin</span>
                  <span className="sr-only 2xl:hidden">Admin</span>
                </Link>
              )}
              <Link
                href="/tickets/new"
                className="btn btn-sm border-white bg-transparent text-white hover:bg-white hover:text-ink"
              >
                <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
                <span className="hidden 2xl:inline">New ticket</span>
                <span className="sr-only 2xl:hidden">New ticket</span>
              </Link>
              <div className="flex items-center gap-1 border-l border-white/25 pl-2">
                <Link
                  href="/account"
                  className="grid size-8 place-items-center rounded-full border border-white/60 font-display text-xs font-semibold tracking-wider hover:bg-white/10"
                  title={`${user.name} (${role}): your account`}
                  aria-label={`Your account: ${user.name}, ${role}`}
                >
                  {initials}
                </Link>
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
    </LiveUpdates>
  );
}
