// Triage configuration from the environment (kept out of provider.ts, which tests replace).
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const MAX_OUTPUT_TOKENS = 1500;

/** Model id from GEMINI_MODEL, falling back to the small low-cost default. */
export function triageModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

// Defaults sit just below the free tier of gemini-3.5-flash-lite (15 requests/min, 500/day).
// Re-read the live quota in AI Studio when changing model, and set these slightly below it.
export const DEFAULT_AI_DAILY_CAP = 450;
export const DEFAULT_AI_RPM_LIMIT = 12;
export const DEFAULT_AI_MANUAL_RESERVE_PCT = 20;

function intFromEnv(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
}

/** Maximum provider calls per UTC day, from AI_DAILY_CAP (a non-negative integer). */
export function aiDailyCap(): number {
  return intFromEnv("AI_DAILY_CAP", DEFAULT_AI_DAILY_CAP);
}

/** Maximum provider calls in any 60-second window, from AI_RPM_LIMIT. */
export function aiRpmLimit(): number {
  return intFromEnv("AI_RPM_LIMIT", DEFAULT_AI_RPM_LIMIT);
}

/** Percent of the daily cap kept for manual triage; automatic triage may use the rest. */
export function aiManualReservePct(): number {
  return intFromEnv("AI_MANUAL_RESERVE_PCT", DEFAULT_AI_MANUAL_RESERVE_PCT, 100);
}
