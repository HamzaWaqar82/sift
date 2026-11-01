// Runs once when the Next.js server starts. A production app with a mail setup that would lose
// replies (no gmail transport, or no credentials) refuses to start instead of failing per send.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertMailConfig } = await import("@/lib/mail/config");
  try {
    assertMailConfig();
  } catch (error) {
    console.error(`[startup] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
