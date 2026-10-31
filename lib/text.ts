// Text hygiene applied to every user-supplied string before it is validated and stored.

const hex = (n: number) => "\\u" + n.toString(16).padStart(4, "0");
const range = (a: number, b: number) => `${hex(a)}-${hex(b)}`;

/** C0 controls except tab/newline, DEL, C1 controls, zero-width chars, bidi overrides/isolates and BOM. */
const STRIP = new RegExp(
  `[${[
    range(0x00, 0x08),
    range(0x0b, 0x0c),
    range(0x0e, 0x1f),
    range(0x7f, 0x9f),
    range(0x200b, 0x200f),
    range(0x202a, 0x202e),
    range(0x2060, 0x2064),
    range(0x2066, 0x2069),
    hex(0xfeff),
  ].join("")}]`,
  "g",
);
/** Line terminators other than \n: CRLF, CR, NEL, LS, PS. */
const LINE_BREAKS = new RegExp(`\\r\\n?|[${hex(0x85)}${hex(0x2028)}${hex(0x2029)}]`, "g");

/**
 * Normalises to NFC, unifies line endings to \n and strips NUL and other control characters
 * (newlines and tabs are kept). Never HTML-escapes: output is plain text, the UI renders it as text.
 */
export function cleanText(input: string): string {
  return input.normalize("NFC").replace(LINE_BREAKS, "\n").replace(STRIP, "");
}

/** cleanText for single-line fields: newlines and tabs become spaces, runs of spaces collapse. */
export function cleanLine(input: string): string {
  return cleanText(input).replace(/[\n\t]+/g, " ").replace(/ {2,}/g, " ");
}
