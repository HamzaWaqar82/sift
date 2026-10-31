import { z as zod } from "zod";
import { cleanLine, cleanText } from "@/lib/text";

/**
 * Flattens Zod issues into { "field.path": firstMessage } for 400 responses and form display.
 * Issues on the whole input are keyed `rootKey`.
 */
export function fieldErrors(error: zod.ZodError, rootKey = "form"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : rootKey;
    out[key] ??= issue.message;
  }
  return out;
}

// ---- Shared field schemas: sanitise (NFC, strip control chars), trim, then bound the length. ----

/** Required single-line text (names, subjects): control chars stripped, newlines become spaces. */
export function lineField(label: string, max: number) {
  return zod
    .string()
    .transform(cleanLine)
    .pipe(zod.string().trim().min(1, `${label} is required`).max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer`));
}

/** Required multi-line text (message bodies): control chars stripped, newlines and tabs kept. */
export function textField(label: string, max: number) {
  return zod
    .string()
    .transform(cleanText)
    .pipe(zod.string().trim().min(1, `${label} is required`).max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer`));
}

/** Optional single-line text: blank becomes undefined. */
export function optionalLineField(label: string, max: number) {
  return zod
    .string()
    .transform(cleanLine)
    .pipe(zod.string().trim().max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer`))
    .transform((v) => (v ? v : undefined))
    .optional();
}

/** A lower-cased, trimmed, valid email address (at most 254 characters). */
export function emailField(message = "Enter a valid email address") {
  return zod
    .string()
    .transform((s) => cleanLine(s).trim().toLowerCase())
    .pipe(zod.string().max(254, message).pipe(zod.email(message)));
}

/** A positive int4, for ids carried in JSON bodies. */
export const idField = zod.number().int().positive().max(2_147_483_647);
