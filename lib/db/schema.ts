// Drizzle table definitions: the whole Sift data model.
// After editing, run `npm run db:generate` to create a migration in ./drizzle.
//
// Ticket 03 added every table at once (tickets, help articles, triage results, replies,
// AI usage) so later slices built in parallel do not produce conflicting migrations.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["agent", "admin"]);
export const ticketSource = pgEnum("ticket_source", ["webhook", "form"]);
export const ticketStatus = pgEnum("ticket_status", ["open", "replied", "closed"]);
export const triageCategory = pgEnum("triage_category", [
  "billing",
  "technical",
  "account",
  "feature_request",
  "other",
]);
export const triageUrgency = pgEnum("triage_urgency", ["low", "medium", "high"]);
export const userAvailability = pgEnum("user_availability", ["available", "away"]);

// Millisecond precision so timestamps round-trip exactly through JS Dates (cursor paging relies on it).
const tsMs = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

/**
 * Staff accounts; also Better Auth's user model (lib/auth/better-auth.ts). Property names follow
 * Better Auth's (emailVerified, image, updatedAt), which is how it maps onto these columns.
 * Passwords live in `account` (provider_id = 'credential'). New non-null columns need a default,
 * or Better Auth's startup schema check fails.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  availability: userAvailability("availability").notNull().default("available"),
  /** Set when an admin deactivates the user; guards treat their sessions as signed out. */
  deactivatedAt: tsMs("deactivated_at"),
  lastAssignedAt: tsMs("last_assigned_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Better Auth's tables. Ids are serial (advanced.database.generateId) so user_id can reference users.id.

/** Sign-in methods per user. Credential rows hold the bcrypt hash in `password`, with account_id = users.id::text. */
export const account = pgTable(
  "account",
  {
    id: serial("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The unique pair lets the seed upsert credential rows idempotently.
  (t) => [
    uniqueIndex("account_provider_account_idx").on(t.providerId, t.accountId),
    index("account_user_idx").on(t.userId),
  ],
);

/** A signed-in browser. Deleting a row signs that browser out. */
export const session = pgTable(
  "session",
  {
    id: serial("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

/** Better Auth's short-lived tokens (password reset, email change). */
export const verification = pgTable("verification", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Fixed-window counters (lib/auth/rate-limit.ts), kept in the database so restarts don't reset them. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: tsMs("window_start").notNull(),
  count: integer("count").notNull(),
});

/** Who did what (lib/audit.ts). A null actor means the system. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
    targetUserId: integer("target_user_id").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: tsMs("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt.desc(), t.id.desc())],
);

/** One customer message. Every inbound email or form submission creates a new ticket. */
export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    customerEmail: text("customer_email").notNull(),
    customerName: text("customer_name"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    source: ticketSource("source").notNull(),
    status: ticketStatus("status").notNull().default("open"),
    assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** Inbound email message id; unique so duplicate webhook deliveries are ignored. Null for form tickets. */
    externalMessageId: text("external_message_id").unique(),
    createdAt: tsMs("created_at").notNull().defaultNow(),
    updatedAt: tsMs("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tickets_created_at_id_idx").on(t.createdAt.desc(), t.id.desc()),
    index("tickets_status_created_at_id_idx").on(t.status, t.createdAt.desc(), t.id.desc()),
  ],
);

/** Seeded help articles the AI may cite. `id` is a readable slug, e.g. "refund-policy". */
export const helpArticles = pgTable("help_articles", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: tsMs("created_at").notNull().defaultNow(),
});

/**
 * Every triage attempt for a ticket (the ticket shows the latest).
 * A valid result has category, urgency and draft (article optional).
 * A failed one has `error` and the provider's `raw_output`.
 */
export const triageResults = pgTable(
  "triage_results",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    category: triageCategory("category"),
    urgency: triageUrgency("urgency"),
    draft: text("draft"),
    articleId: text("article_id").references(() => helpArticles.id),
    error: text("error"),
    rawOutput: text("raw_output"),
    model: text("model").notNull(),
    requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tsMs("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("triage_results_ticket_created_idx").on(t.ticketId, t.createdAt.desc(), t.id.desc()),
    check(
      "triage_results_valid_or_error",
      sql`(${t.error} is null and ${t.category} is not null and ${t.urgency} is not null and ${t.draft} is not null)
        or (${t.error} is not null and ${t.category} is null and ${t.urgency} is null and ${t.draft} is null and ${t.articleId} is null)`,
    ),
  ],
);

/** A sent reply (recorded in the app only; no email is delivered). */
export const replies = pgTable(
  "replies",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    aiDraft: text("ai_draft"),
    finalBody: text("final_body").notNull(),
    sentBy: integer("sent_by")
      .notNull()
      .references(() => users.id),
    sentAt: tsMs("sent_at").notNull().defaultNow(),
    edited: boolean("edited").notNull(),
    /** Client-generated key; a second submit with the same key does not create a second reply. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
  },
  (t) => [index("replies_ticket_sent_idx").on(t.ticketId, t.sentAt)],
);

/** Number of AI provider calls per UTC day, checked against AI_DAILY_CAP. */
export const aiUsage = pgTable("ai_usage", {
  day: date("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
});

/**
 * A user's saved ticket view: a name plus the list state it restores (view type, filters,
 * sort, page size). Private to its owner; at most MAX_SAVED_VIEWS per user (lib/views).
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Validated list params, e.g. { view: "table", status: "open", sort: "oldest" }. */
    params: jsonb("params").$type<Record<string, string>>().notNull(),
    createdAt: tsMs("created_at").notNull().defaultNow(),
    updatedAt: tsMs("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saved_views_user_name_idx").on(t.userId, t.name)],
);

export type UserRole =(typeof userRole.enumValues)[number];
export type UserAvailability = (typeof userAvailability.enumValues)[number];
export type TicketSource = (typeof ticketSource.enumValues)[number];
export type TicketStatus = (typeof ticketStatus.enumValues)[number];
export type TriageCategory = (typeof triageCategory.enumValues)[number];
export type TriageUrgency = (typeof triageUrgency.enumValues)[number];

/** A staff user as shown next to tickets and replies (assignee, reply sender, assignee picker). */
export type UserRef = { id: number; name: string; email: string };

/** A help article the AI may cite; also what the article panel shows. */
export type HelpArticle = { id: string; title: string; body: string };
