"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Presence } from "@/lib/users/availability";
import { useAnchoredPopover } from "./use-anchored-popover";

/**
 * Header chip: my Available/Away state, opening the team's presence. I can flip my own state;
 * admins can also set anyone Away. Away stops new tickets, never takes owned ones away.
 */
export function PresenceMenu({ meId, team, admin }: { meId: number; team: Presence[]; admin: boolean }) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useAnchoredPopover(button, pop, "right");
  const me = team.find((p) => p.id === meId);
  const availableCount = team.filter((p) => p.availability === "available").length;

  async function set(id: number, availability: Presence["availability"]) {
    setPending(id);
    setError(null);
    const res = await fetch(`/api/users/${id}/availability`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability }),
    }).catch(() => null);
    setPending(null);
    if (!res?.ok) {
      setError("Could not change availability. Try again.");
      return;
    }
    router.refresh();
  }

  if (!me) return null;
  const away = me.availability === "away";
  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget="presence-menu"
        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-band-ink transition-colors duration-150 hover:bg-white/10 hover:text-white"
        title={`You are ${away ? "Away: no new tickets" : "Available"}. ${availableCount} of ${team.length} available.`}
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${away ? "border border-band-ink" : "bg-ok-tint"}`} />
        <span className="sr-only font-display text-xs font-semibold uppercase tracking-[0.08em] sm:not-sr-only">{away ? "Away" : "Available"}</span>
      </button>
      <div ref={pop} id="presence-menu" popover="auto" className="pop w-72" aria-label="Team availability">
        <div className="space-y-3 p-3 text-ink">
          <button
            type="button"
            className="btn btn-sm w-full"
            disabled={pending !== null}
            onClick={() => set(meId, away ? "available" : "away")}
          >
            {away ? "Set me Available" : "Set me Away"}
          </button>
          <p className="text-xs text-ink-2">
            {away ? "You get no new tickets while Away." : "New tickets can be assigned to you."} You keep the ones you own.
          </p>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.08em]">
            Team <span className="num">{availableCount}</span>/<span className="num">{team.length}</span> available
          </p>
          <ul className="space-y-1.5">
            {team.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span aria-hidden="true" className={`size-2 rounded-full ${p.availability === "available" ? "bg-ok-ink" : "border border-ink-3"}`} />
                <span className="flex-1">
                  {p.name}
                  {p.id === meId && <span className="text-ink-2"> (you)</span>}
                </span>
                <span className="text-xs capitalize text-ink-2">{p.availability}</span>
                {admin && p.id !== meId && p.availability === "available" && (
                  <button type="button" className="link text-xs" disabled={pending !== null} onClick={() => set(p.id, "away")}>
                    Set away
                  </button>
                )}
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-sm text-jet-ink">{error}</p>}
        </div>
      </div>
    </>
  );
}
