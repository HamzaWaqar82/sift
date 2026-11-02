// Better Auth on Sift's own integer-id `users` table (mapping chosen in ticket 03; see the spec's
// "Identity spike outcome"). Sessions are database rows, so they can be listed and revoked.
// Only the endpoints Sift routes to are reachable (app/api/auth/*); there is no catch-all route.
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { account, session, users, verification } from "@/lib/db/schema";
import { COOKIE_PREFIX } from "./cookie";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, absolute
const BCRYPT_COST = 10;

/** Hashes a password the way Better Auth stores and checks credentials. */
export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return value;
}

/** The public origin. Behind Caddy, req.url is the bound 0.0.0.0, so the origin check needs this. */
export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

function createAuth() {
  return betterAuth({
    secret: secret(),
    baseURL: appBaseUrl(),
    database: drizzleAdapter(getDb(), { provider: "pg", schema: { users, account, session, verification } }),
    user: {
      modelName: "users",
      additionalFields: {
        role: { type: "string", required: true, input: false },
        deactivatedAt: { type: "date", required: false, input: false },
      },
    },
    session: { expiresIn: SESSION_MAX_AGE_SECONDS, disableSessionRefresh: true },
    emailAndPassword: {
      enabled: true,
      // Teammates join by invitation only.
      disableSignUp: true,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },
    // Sign-in failures are limited per IP and per email in the rate_limits table (lib/auth/rate-limit.ts).
    rateLimit: { enabled: false },
    databaseHooks: {
      session: {
        create: {
          // A deactivated user cannot start a session; Better Auth answers 401 like a bad password.
          before: async (row) => {
            const [active] = await getDb()
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.id, Number(row.userId)), isNull(users.deactivatedAt)))
              .limit(1);
            return active ? undefined : false;
          },
        },
      },
    },
    advanced: {
      database: { generateId: "serial" },
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: process.env.NODE_ENV === "production",
      // Better Auth skips the origin check under NODE_ENV=test; keep it on so tests match production.
      disableOriginCheck: false,
    },
  });
}

type Auth = ReturnType<typeof createAuth>;
let auth: Auth | undefined;

/** Lazily-created Better Auth instance (reads DATABASE_URL and SESSION_SECRET at first use). */
export function getAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
