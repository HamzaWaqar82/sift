// Shared HTTP plumbing for route handlers: one error body shape, one JSON body parser,
// id helpers, a catch-all wrapper and host-safe redirects.
//
// Every error response is JSON `{ error: string, code?: string, fields?: Record<string,string> }`.
import { NextResponse } from "next/server";
import type { z } from "zod";
import { fieldErrors } from "@/lib/validation";

export type ErrorBody = { error: string; code?: string; fields?: Record<string, string> };

export function apiError(status: number, error: string, extra: { code?: string; fields?: Record<string, string> } = {}) {
  const body: ErrorBody = {
    error,
    ...(extra.code ? { code: extra.code } : {}),
    ...(extra.fields ? { fields: extra.fields } : {}),
  };
  return NextResponse.json(body, { status });
}

/** Thrown by helpers; the `route()` wrapper turns it into the uniform error response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Default cap for JSON request bodies. */
export const MAX_JSON_BYTES = 256 * 1024;

/**
 * Reads the body as text, or returns null once it exceeds `maxBytes`. A declared Content-Length
 * over the limit is refused without reading; otherwise the stream is counted as it arrives and
 * cancelled at the limit, so a missing or false length cannot make the server buffer more.
 */
export async function readBodyWithLimit(req: Request, maxBytes = MAX_JSON_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Parses a JSON request body. Throws HttpError 413 `payload_too_large` over `maxBytes`, and
 * 400 `invalid_json` for unparsable (or, unless `allowEmpty`, empty) text. An empty body with
 * `allowEmpty` yields `{}`.
 */
export async function readJson(req: Request, opts: { maxBytes?: number; allowEmpty?: boolean } = {}): Promise<unknown> {
  const maxBytes = opts.maxBytes ?? MAX_JSON_BYTES;
  const text = await readBodyWithLimit(req, maxBytes);
  if (text === null) {
    throw new HttpError(413, `Body exceeds the ${Math.round(maxBytes / 1024)} KiB limit`, "payload_too_large");
  }
  if (!text.trim()) {
    if (opts.allowEmpty) return {};
    throw new HttpError(400, "Body must be valid JSON", "invalid_json");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be valid JSON", "invalid_json");
  }
}

/** readJson + schema parse; throws a 400 HttpError (`validation_failed`, with `fields`) on failure. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  opts: { maxBytes?: number; allowEmpty?: boolean; message?: string; rootKey?: string } = {},
): Promise<z.output<S>> {
  const json = await readJson(req, opts);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new HttpError(
      400,
      opts.message ?? "Please fix the highlighted fields",
      "validation_failed",
      fieldErrors(parsed.error, opts.rootKey),
    );
  }
  return parsed.data;
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response> | Response;

/**
 * Wraps a route handler: HttpError becomes its uniform error body; anything else is logged
 * server-side and answered with a generic 500 (no stack traces, no database error text).
 */
export function route<Ctx = unknown>(handler: Handler<Ctx>): (req: Request, ctx?: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx as Ctx);
    } catch (err) {
      if (err instanceof HttpError) return apiError(err.status, err.message, { code: err.code, fields: err.fields });
      console.error(`[api] unhandled error in ${req.method} ${safePath(req)}:`, err);
      return apiError(500, "Something went wrong. Please try again.", { code: "internal_error" });
    }
  };
}

function safePath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "?";
  }
}

/** A positive int4 id from a URL segment or query value, or null (non-numeric, zero, overflow). */
export function parseIntId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 && id <= 2_147_483_647 ? id : null;
}

/**
 * A redirect that never embeds a host: the Location is the given relative path, so the browser
 * resolves it against the public origin it actually used. The app binds 0.0.0.0 behind Caddy,
 * so `req.url` must never be used to build an absolute redirect URL.
 */
export function relativeRedirect(path: string, status: 301 | 302 | 303 | 307 | 308 = 303): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("relativeRedirect needs a same-site absolute path");
  return new NextResponse(null, { status, headers: { Location: path } });
}
