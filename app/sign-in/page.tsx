import { redirect } from "next/navigation";
import { getPageUser } from "@/lib/auth";
import { Wordmark } from "../_components/logo";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getPageUser()) redirect("/");
  const now = new Date();
  const day = now.toLocaleString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const year = `${now.toLocaleString("en-GB", { weekday: "long", timeZone: "UTC" })} ${now.getUTCFullYear()}`;

  return (
    <main className="flex min-h-screen flex-col">
      <div className="band h-2 bg-ink" aria-hidden="true" />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-3xl">
          <div className="tab-row pl-4">
            <span className="tab" data-tone="navy">
              Staff pass
            </span>
            <span className="tab">Support desk</span>
          </div>
          <div className="coupon grid md:grid-cols-[17rem_1fr]">
            {/* Stub: a pass's data block (today's date, desk, class), no invented figures. */}
            <div className="flex flex-col gap-5 bg-panel-2 p-6 md:rounded-l-[var(--radius-coupon)]">
              <Wordmark size="lg" />
              <div>
                <p className="field-label">Date</p>
                <p className="font-display text-[2.6rem] font-bold uppercase leading-none tracking-[0.02em] text-carbon">
                  {day}
                </p>
                <p className="num mt-1 text-xs">{year} · UTC</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-rule py-3 text-sm">
                <div>
                  <dt className="field-label">Desk</dt>
                  <dd className="mt-0.5 font-medium text-ink">Support inbox</dd>
                </div>
                <div>
                  <dt className="field-label">Class</dt>
                  <dd className="mt-0.5 font-medium text-ink">Staff only</dd>
                </div>
                <div>
                  <dt className="field-label">Roles</dt>
                  <dd className="mt-0.5 font-medium text-ink">Agent, Admin</dd>
                </div>
                <div>
                  <dt className="field-label">Sign-up</dt>
                  <dd className="mt-0.5 font-medium text-ink">None</dd>
                </div>
              </dl>
              <p className="text-sm text-ink-2">One inbox for the whole team. AI drafts every reply; a person reviews and sends it.</p>
            </div>
            {/* Perforation: horizontal on narrow screens, vertical beside the stub on wide ones. */}
            <div className="perf md:hidden" style={{ ["--perf-bg" as string]: "var(--color-ground)" }} aria-hidden="true" />
            <div className="p-6 perf-v md:p-8">
              <h1 className="caps-bold text-2xl text-ink">Sign in</h1>
              <p className="mt-1 text-sm text-ink-2">Use the email and password your admin gave you.</p>
              <SignInForm />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
