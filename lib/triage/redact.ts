// Removes customer contact details from ticket text before it leaves the app for the AI provider.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// A run of digits with common phone separators (space, dot, dash, parentheses), optionally
// starting with "+". Only runs with at least 9 digits count as phone numbers, so dates
// (2026-10-31), amounts and short order or invoice numbers are kept.
const PHONE_CANDIDATE = /(?<![\w+])\+?\(?\d[\d \t().-]{6,}\d(?![\w])/g;
const MIN_PHONE_DIGITS = 9;

export function redactContactDetails(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(PHONE_CANDIDATE, (match) =>
      match.replace(/\D/g, "").length >= MIN_PHONE_DIGITS ? "[phone removed]" : match,
    );
}
