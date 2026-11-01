/** Splits the header block of a raw RFC 5322 message into [name, value] pairs. */
export function parseHeaders(raw: string): [string, string][] {
  const block = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const headers: [string, string][] = [];
  for (const line of block.split(/\r?\n/)) {
    const last = headers.at(-1);
    if (/^[ \t]/.test(line) && last) {
      last[1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0) headers.push([line.slice(0, colon), line.slice(colon + 1).trim()]);
  }
  return headers;
}
