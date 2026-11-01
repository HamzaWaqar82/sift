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

// Millisecond precision so timestamps round-trip exactly through JS Dates (cursor paging relies on it).
const tsMs = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

/** Seeded staff accounts (no sign-up). Rows are created by scripts/seed.mjs. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed"]);

/**
 * Background work for the worker service (lib/jobs). Claimed with FOR UPDATE SKIP LOCKED in
 * order of priority (higher first), then run_at. `locked_at` marks a running claim; a claim
 * older than the stale-lock window is recovered. Exhausted jobs stay as `failed` with the last
 * error so admins can see them.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull().default({}),
    priority: integer("priority").notNull().default(0),
    runAt: tsMs("run_at").notNull().defaultNow(),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: tsMs("locked_at"),
    lastError: text("last_error"),
    createdAt: tsMs("created_at").notNull().defaultNow(),
    finishedAt: tsMs("finished_at"),
  },
  (t) => [
    index("jobs_due_idx")
      .on(t.priority.desc(), t.runAt, t.id)
      .where(sql`${t.status} = 'queued'`),
    index("jobs_running_idx").on(t.lockedAt).where(sql`${t.status} = 'running'`),
  ],
);

/** Liveness of long-running processes; the worker upserts its row every loop. */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  name: text("name").primaryKey(),
  beatAt: tsMs("beat_at").notNull().defaultNow(),
});

/**
 * Mail kept by the `capture` transport instead of being delivered (dev and staging), shown at
 * /dev/mailbox. `raw` is the full RFC 5322 message exactly as it would have been sent.
 */
export const devMailbox = pgTable(
  "dev_mailbox",
  {
    id: serial("id").primaryKey(),
    messageId: text("message_id").notNull(),
    from: text("from").notNull(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    html: text("html"),
    raw: text("raw").notNull(),
    capturedAt: tsMs("captured_at").notNull().defaultNow(),
  },
  (t) => [index("dev_mailbox_captured_idx").on(t.capturedAt.desc(), t.id.desc())],
);

export type UserRole =(typeof userRole.enumValues)[number];
export type TicketSource = (typeof ticketSource.enumValues)[number];
export type TicketStatus = (typeof ticketStatus.enumValues)[number];
export type TriageCategory = (typeof triageCategory.enumValues)[number];
export type TriageUrgency = (typeof triageUrgency.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];

/** A staff user as shown next to tickets and replies (assignee, reply sender, assignee picker). */
export type UserRef = { id: number; name: string; email: string };

/** A help article the AI may cite; also what the article panel shows. */
export type HelpArticle = { id: string; title: string; body: string };
