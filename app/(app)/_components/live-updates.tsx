"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { SiftEvent } from "@/lib/events/types";

const MAX_FAILURES = 3;
const POLL_MS = 20_000;
/** Events often come in bursts (a reply is a message plus a status change): refetch once. */
const REFRESH_DEBOUNCE_MS = 250;

type Listener = (event: SiftEvent) => void;
type Live = { userId: number; paused: boolean; listen: (fn: Listener) => () => void };

const LiveContext = createContext<Live>({ userId: 0, paused: false, listen: () => () => {} });

/**
 * One EventSource per signed-in tab. Every event refetches the server-rendered page in place
 * (`router.refresh()`): new tickets land at the top of the list, rows and counts update, and
 * client state such as an open reply composer is kept. After 3 failed connections it polls
 * every 20 seconds instead (still trying to reconnect each time) and shows a paused chip.
 */
export function LiveUpdates({ userId, children }: { userId: number; children: React.ReactNode }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [toast, setToast] = useState<number | null>(null);
  const listeners = useRef(new Set<Listener>());
  const [live] = useState(() => ({
    listen(fn: Listener) {
      listeners.current.add(fn);
      return () => void listeners.current.delete(fn);
    },
  }));

  useEffect(() => {
    let source: EventSource | null = null;
    let failures = 0;
    let poll: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;

    const refreshSoon = () => {
      clearTimeout(refresh);
      refresh = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };

    function connect() {
      const es = (source = new EventSource("/api/events"));
      es.onopen = () => {
        failures = 0;
        clearInterval(poll);
        poll = undefined;
        setPaused(false);
      };
      es.onmessage = (msg) => {
        let event: SiftEvent;
        try {
          event = JSON.parse(msg.data);
        } catch {
          return;
        }
        for (const fn of listeners.current) fn(event);
        if ((event.type === "ticket.assigned" || event.type === "ticket.created") && event.assigneeId === userId) {
          setToast(event.ticketId);
        }
        refreshSoon();
      };
      es.onerror = () => {
        // Take over reconnecting ourselves, so failures are counted the same in every browser.
        es.close();
        if (source === es) source = null;
        failures += 1;
        if (failures < MAX_FAILURES) {
          retry = setTimeout(connect, 1000 * failures);
        } else if (!poll) {
          setPaused(true);
          poll = setInterval(() => {
            router.refresh();
            if (!source) connect();
          }, POLL_MS);
        }
      };
    }

    connect();
    return () => {
      source?.close();
      source = null;
      clearInterval(poll);
      clearTimeout(retry);
      clearTimeout(refresh);
    };
  }, [router, userId]);

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <LiveContext.Provider value={{ userId, paused, listen: live.listen }}>
      {children}
      {toast !== null && (
        <div
          role="status"
          className="coupon fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 text-sm shadow-lg"
        >
          <span>
            Ticket <span className="num">#{toast}</span> was assigned to you.
          </span>
          <Link href={`/tickets/${toast}`} className="link font-medium" onClick={() => setToast(null)}>
            Open
          </Link>
        </div>
      )}
    </LiveContext.Provider>
  );
}

/** Header chip, shown only while the live connection is down and the page is polling. */
export function LiveStatusChip() {
  const { paused } = useContext(LiveContext);
  if (!paused) return null;
  return (
    <span
      role="status"
      title="The live connection failed. Sift checks for changes every 20 seconds and keeps trying to reconnect."
      className="whitespace-nowrap rounded-sm border border-white/40 px-2 py-0.5 font-display text-2xs font-semibold uppercase tracking-[0.1em] text-band-ink"
    >
      Live updates paused
    </span>
  );
}

/** "<name> just replied": a teammate's reply arrived on the ticket being viewed. */
export function JustReplied({ ticketId }: { ticketId: number }) {
  const { userId, listen } = useContext(LiveContext);
  const [name, setName] = useState<string | null>(null);
  useEffect(
    () =>
      listen((e) => {
        if (
          e.type === "message.created" &&
          e.ticketId === ticketId &&
          e.direction === "outbound" &&
          e.authorId !== userId
        ) {
          setName(e.authorName ?? "A teammate");
        }
      }),
    [listen, ticketId, userId],
  );
  if (!name) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-3 rounded-[var(--radius-coupon)] border border-warn-ink/30 bg-warn-tint px-4 py-2.5 text-sm text-warn-ink"
    >
      <span className="flex-1">
        <span className="font-semibold">{name}</span> just replied. Check the thread before sending yours.
      </span>
      <button type="button" className="link text-xs" onClick={() => setName(null)}>
        Dismiss
      </button>
    </p>
  );
}
