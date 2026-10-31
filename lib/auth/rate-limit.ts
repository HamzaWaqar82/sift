// In-memory limit on failed sign-ins per client address. Single app instance, so memory is
// enough; counts reset on restart (acceptable for this scope).
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { failures: number; windowStart: number };
const failuresByAddress = new Map<string, Entry>();

/**
 * Client address. In production only Caddy can reach the app, and Caddy overwrites
 * X-Forwarded-For with the real client IP, so the first entry is trustworthy there.
 */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

/** The address's failure entry within the current window; drops it once the window has expired. */
function activeEntry(address: string, now: number): Entry | undefined {
  const entry = failuresByAddress.get(address);
  if (entry && now - entry.windowStart >= WINDOW_MS) {
    failuresByAddress.delete(address);
    return undefined;
  }
  return entry;
}

/** Seconds until this address may try again, or 0 if it is not blocked. */
export function signInBlockedFor(address: string, now = Date.now()): number {
  const entry = activeEntry(address, now);
  if (!entry || entry.failures < MAX_FAILURES) return 0;
  return Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
}

export function recordSignInFailure(address: string, now = Date.now()): void {
  const entry = activeEntry(address, now);
  if (entry) entry.failures += 1;
  else failuresByAddress.set(address, { failures: 1, windowStart: now });
}

export function clearSignInFailures(address: string): void {
  failuresByAddress.delete(address);
}
