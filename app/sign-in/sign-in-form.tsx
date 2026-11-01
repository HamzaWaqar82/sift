"use client";

import { ArrowRight, CircleAlert, Clock } from "lucide-react";
import { useState } from "react";

type Problem = { kind: "error" | "rate"; message: string } | null;

function retryText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Try again in a few minutes.";
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "Try again in about a minute." : `Try again in about ${minutes} minutes.`;
}

export function SignInForm() {
  const [problem, setProblem] = useState<Problem>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setProblem(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (res.ok) {
        window.location.assign("/");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setProblem({
          kind: "rate",
          message: `Too many failed attempts. ${retryText(Number(res.headers.get("retry-after")))}`,
        });
      } else {
        setProblem({ kind: "error", message: body.error ?? "Sign-in failed. Check your details and try again." });
      }
    } catch {
      setProblem({ kind: "error", message: "Could not reach Sift. Check your connection and try again." });
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" aria-describedby={problem ? "sign-in-problem" : undefined}>
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@company.com"
          aria-invalid={problem?.kind === "error" || undefined}
          className="input"
        />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your Sift password"
          aria-invalid={problem?.kind === "error" || undefined}
          className="input"
        />
      </div>
      <div aria-live="polite">
        {problem && (
          <p
            id="sign-in-problem"
            role="alert"
            className={`flex items-start gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm ${
              problem.kind === "rate" ? "bg-warn-tint text-warn-ink" : "bg-jet-tint text-jet-ink"
            }`}
          >
            {problem.kind === "rate" ? (
              <Clock className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            )}
            {problem.message}
          </p>
        )}
      </div>
      <button type="submit" disabled={pending} className="btn btn-navy w-full" aria-busy={pending}>
        {pending ? "Checking pass…" : "Sign in"}
        {!pending && <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden="true" />}
      </button>
    </form>
  );
}
