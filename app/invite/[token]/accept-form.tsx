"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";

export function AcceptForm({ token }: { token: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setProblem(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: form.get("name"), password: form.get("password") }),
      });
      if (res.ok) {
        window.location.assign("/");
        return;
      }
      const body = await res.json().catch(() => ({}));
      setProblem(body.fields?.password ?? body.fields?.name ?? body.error ?? "Could not join. Try again.");
    } catch {
      setProblem("Could not reach Sift. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="name" className="label">
          Your name
        </label>
        <input id="name" name="name" autoComplete="name" required maxLength={100} className="input" />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={72}
          className="input"
        />
        <p className="mt-1 text-xs text-ink-3">At least 10 characters.</p>
      </div>
      <div aria-live="polite">
        {problem && (
          <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] bg-jet-tint px-3 py-2 text-sm text-jet-ink">
            <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {problem}
          </p>
        )}
      </div>
      <button type="submit" disabled={pending} className="btn btn-navy w-full" aria-busy={pending}>
        {pending ? "Joining…" : "Join Sift"}
      </button>
    </form>
  );
}
