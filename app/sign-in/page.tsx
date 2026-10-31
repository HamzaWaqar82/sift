import { redirect } from "next/navigation";
import { getPageUser } from "@/lib/auth";
import { Wordmark } from "../_components/logo";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getPageUser()) redirect("/");

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
            {/* Stub */}
            <div className="flex flex-col justify-between gap-8 bg-panel-2 p-6 md:rounded-l-[var(--radius-coupon)]">
              <Wordmark size="lg" />
              <div className="space-y-4 text-sm text-ink-2">
                <p>One inbox for the whole team. AI drafts every reply; a person reviews and sends it.</p>
                <dl className="grid grid-cols-2 gap-x-4 border-t border-rule pt-3">
                  <div>
                    <dt className="field-label">Access</dt>
                    <dd className="mt-0.5 font-medium text-ink">Team accounts</dd>
                  </div>
                  <div>
                    <dt className="field-label">Roles</dt>
                    <dd className="mt-0.5 font-medium text-ink">Agent, Admin</dd>
                  </div>
                </dl>
              </div>
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
