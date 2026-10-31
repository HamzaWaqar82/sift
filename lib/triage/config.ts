// Triage configuration from the environment (kept out of provider.ts, which tests replace).
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const MAX_OUTPUT_TOKENS = 1500;

/** Model id from GEMINI_MODEL, falling back to the small low-cost default. */
export function triageModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export const DEFAULT_AI_DAILY_CAP = 50;

/** Maximum provider calls per UTC day, from AI_DAILY_CAP (a non-negative integer). */
export function aiDailyCap(): number {
  const n = Number.parseInt(process.env.AI_DAILY_CAP ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AI_DAILY_CAP;
}
