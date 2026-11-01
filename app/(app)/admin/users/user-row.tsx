"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminUser } from "@/lib/admin/users";

/** One team member: role picker plus deactivate / reactivate. Your own row is read-only. */
export function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(path: string, body?: unknown) {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${user.id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) router.refresh();
    else setError((await res?.json().catch(() => null))?.error ?? "Could not save the change");
    setPending(false);
  }

  return (
    <tr className="border-t border-rule-soft align-middle">
      <td className="px-3 py-2">
        <div className="font-medium text-ink">
          {user.name}
          {isSelf && <span className="ml-1.5 text-xs font-normal text-ink-3">(you)</span>}
        </div>
        <div className="text-xs text-ink-3">{user.email}</div>
      </td>
      <td className="px-3 py-2">
        {isSelf ? (
          <span className="capitalize">{user.role}</span>
        ) : (
          <>
            <label htmlFor={`role-${user.id}`} className="sr-only">
              Role for {user.name}
            </label>
            <select
              id={`role-${user.id}`}
              value={user.role}
              disabled={pending}
              onChange={(e) => act("role", { role: e.target.value })}
              className="h-[1.875rem] rounded-[var(--radius-control)] border border-ink-3 bg-panel px-1.5 text-sm text-ink hover:border-ink"
            >
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </>
        )}
      </td>
      <td className="px-3 py-2 capitalize text-ink-2">{user.availability}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="stamp" data-state={user.active ? "open" : "closed"}>
            {user.active ? "Active" : "Deactivated"}
          </span>
          {!isSelf && (
            <button
              type="button"
              disabled={pending}
              onClick={() => act(user.active ? "deactivate" : "reactivate")}
              className="btn btn-sm"
            >
              {user.active ? "Deactivate" : "Reactivate"}
            </button>
          )}
          <span aria-live="polite" className="text-xs">
            {error && (
              <span role="alert" className="text-jet-ink">
                {error}
              </span>
            )}
          </span>
        </div>
      </td>
    </tr>
  );
}
