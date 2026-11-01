// Live event bus. `publish` sends Postgres NOTIFY on one channel, so any process (app or worker)
// can publish. Each app process keeps ONE dedicated LISTEN connection and fans events out to its
// in-process subscribers (the SSE streams). There is a single app instance; no broker needed.
import { sql, type SQL } from "drizzle-orm";
import postgres from "postgres";
import { getDb } from "@/lib/db";
import type { SiftEvent } from "./types";

export type { SiftEvent, SiftEventType } from "./types";

export const EVENTS_CHANNEL = "sift_events";

type Listener = (event: SiftEvent) => void;
/** Anything that can run a statement: the shared db or a transaction. */
type Executor = { execute: (query: SQL) => PromiseLike<unknown> };

/**
 * Publishes one event: `await publish({ type: "ticket.updated", ticketId, status })`.
 * Pass the transaction as `db` when the change is inside one: NOTIFY is then delivered only if
 * and when it commits. Never throws; a lost live event only delays the UI until the next poll.
 */
export async function publish(event: SiftEvent, db: Executor = getDb()): Promise<void> {
  try {
    await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
  } catch (err) {
    console.error("publish failed", event.type, err);
  }
}

type Bus = { listeners: Set<Listener>; ready: Promise<unknown> | null };
// Kept on globalThis so dev hot reloads reuse the one LISTEN connection.
const bus: Bus = ((globalThis as { __siftEventBus?: Bus }).__siftEventBus ??= { listeners: new Set(), ready: null });

function startListening(): Promise<unknown> {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.reject(new Error("DATABASE_URL is not set"));
  // postgres-js gives listen() its own connection and re-LISTENs after a reconnect.
  const client = postgres(url, { max: 1, onnotice: () => {} });
  return client.listen(EVENTS_CHANNEL, (payload) => {
    let event: SiftEvent;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    for (const listener of bus.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("event listener failed", err);
      }
    }
  });
}

/** Subscribes to every event. Resolves once LISTEN is active; returns the unsubscribe function. */
export async function subscribe(listener: Listener): Promise<() => void> {
  bus.listeners.add(listener);
  bus.ready ??= startListening().catch((err) => {
    bus.ready = null;
    throw err;
  });
  try {
    await bus.ready;
  } catch (err) {
    bus.listeners.delete(listener);
    throw err;
  }
  return () => {
    bus.listeners.delete(listener);
  };
}
