export type SeedUserKey = "admin" | "alice" | "ben" | "chloe" | "dev";
export const SEED_USERS: ReadonlyArray<{
  key: SeedUserKey;
  email: string;
  name: string;
  role: "agent" | "admin";
  /** Environment variable holding this account's password, e.g. SEED_PASSWORD_ALICE. */
  passwordEnv: string;
}>;
/** Each account's password from its SEED_PASSWORD_<NAME> variable. */
export function passwordsFromEnv(env?: Record<string, string | undefined>): Partial<Record<SeedUserKey, string>>;
/** Upserts the staff accounts; throws naming the variables of any missing password. */
export function seedUsers(url: string, passwords: Partial<Record<SeedUserKey, string | undefined>>): Promise<void>;
/** Seeds samples/emails.json as webhook tickets aged relative to `now` (idempotent on message_id). Returns how many were new. */
export function seedSampleTickets(url: string, now?: Date): Promise<number>;
/** Upserts samples/help-articles.json into help_articles. Returns how many articles. */
export function seedHelpArticles(url: string): Promise<number>;
