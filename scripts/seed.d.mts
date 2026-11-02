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
/** Inserts missing staff accounts, never touching existing ones; throws naming the variables of any missing password. */
export function seedUsers(url: string, passwords: Partial<Record<SeedUserKey, string | undefined>>): Promise<void>;
/** The demo emails in samples/emails.json. */
export function sampleEmails(): Promise<Array<{ from: { email: string; name?: string }; subject: string; body: string; received_at: string; message_id: string }>>;
/** Seeds the staff only into an empty users table (the CLI path). Returns whether it seeded. */
export function seedStaffIfEmpty(url: string, passwords: Partial<Record<SeedUserKey, string | undefined>>): Promise<boolean>;
/** Seeds samples/emails.json as webhook tickets aged relative to `now` (idempotent on message_id); none when env.APP_ENV is production. Returns how many were new. */
export function seedSampleTickets(url: string, now?: Date, env?: Record<string, string | undefined>): Promise<number>;
/** Upserts samples/help-articles.json into help_articles. Returns how many articles. */
export function seedHelpArticles(url: string): Promise<number>;
