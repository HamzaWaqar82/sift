import type { z } from "zod";

/**
 * Flattens Zod issues into { "field.path": firstMessage } for 400 responses and form display.
 * Issues on the whole input are keyed `rootKey`.
 */
export function fieldErrors(error: z.ZodError, rootKey = "form"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : rootKey;
    out[key] ??= issue.message;
  }
  return out;
}
