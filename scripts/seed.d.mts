export const SEED_USERS: ReadonlyArray<{ email: string; name: string; role: "agent" | "admin" }>;
export function seedUsers(
  url: string,
  passwords: { adminPassword: string | undefined; agentPassword: string | undefined },
): Promise<void>;
/** Seeds samples/emails.json as webhook tickets (idempotent on message_id). Returns how many were new. */
export function seedSampleTickets(url: string): Promise<number>;
/** Upserts samples/help-articles.json into help_articles. Returns how many articles. */
export function seedHelpArticles(url: string): Promise<number>;
