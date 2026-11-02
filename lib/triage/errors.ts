// Provider errors the triage job treats specially. Kept out of provider.ts so tests that replace
// the provider can still throw them.

/** The provider refused the call for rate or quota reasons (HTTP 429). Requeued, never stored as a failure. */
export class AiRateLimitedError extends Error {
  constructor(
    message: string,
    /** The provider's Retry-After (or RetryInfo delay) in seconds, when it sent one. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "AiRateLimitedError";
  }
}

/**
 * The SDK does not expose response headers, but a Gemini 429 body carries the Retry-After as a
 * google.rpc.RetryInfo detail, e.g. "retryDelay": "13s". Null when absent.
 */
export function retryDelaySeconds(message: string): number | null {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return m ? Math.ceil(Number(m[1])) : null;
}
