import { requireUser } from "@/lib/auth";
import { subscribe } from "@/lib/events";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** A comment line keeps proxies and the browser from timing out an idle stream. */
const HEARTBEAT_MS = 20_000;

/**
 * GET /api/events: Server-Sent Events for a signed-in user. Each event is one unnamed `data:` line
 * holding a SiftEvent (ids and small facts; clients refetch what they show). Caddy must not buffer
 * it (see the Caddyfile); `X-Accel-Buffering: no` tells any other proxy the same.
 */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = await subscribe((event) => send(`data: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      // Sent once subscribed, so the client (and tests) know no event can be missed from here.
      send("retry: 5000\n: connected\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});
