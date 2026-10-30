// Drizzle table definitions. Later tickets add tickets, replies, triage, articles.
// After editing, run `npm run db:generate` to create a migration in ./drizzle.
import { pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["agent", "admin"]);

/** Seeded staff accounts (no sign-up). Rows are created by scripts/seed.mjs. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRole = (typeof userRole.enumValues)[number];
