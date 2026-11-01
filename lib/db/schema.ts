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
export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
/** How a ticket got its current owner (null while unowned or for owners set before ticket 19). */
export const ticketAssignedBy = pgEnum("ticket_assigned_by", ["auto", "admin", "claim", "system"]);
export const messageStatus = pgEnum("message_status", ["queued", "sending", "sent", "failed", "bounced"]);

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

/** A customer conversation. Every inbound email or form submission creates a new ticket (threading comes later). */
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
    /** When the customer last wrote (the latest inbound message). */
    lastInboundAt: tsMs("last_inbound_at"),
    /** When a reply last reached `sent`. Null until the first one. */
    lastOutboundAt: tsMs("last_outbound_at"),
    assignedBy: ticketAssignedBy("assigned_by"),
    /** Who the ticket was last released to the pool from, and why (kept as history after a new claim). */
    releasedFromUserId: integer("released_from_user_id").references(() => users.id, { onDelete: "set null" }),
    releaseReason: text("release_reason"),
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

/**
 * The conversation: every inbound and outbound message of a ticket.
 * Expand step: `tickets.body` and `replies` are still written alongside and are dropped once
 * threading is live. The first inbound message is the ticket body; outbound messages carry the
 * same idempotency key as their `replies` row. Delivery state (status, attempts, last error,
 * provider id) applies to outbound only; inbound rows leave status null.
 */
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    /** The staff user who wrote an outbound message; null when inbound. */
    authorId: integer("author_id").references(() => users.id),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html"),
    /** RFC 5322 Message-ID; unique so a redelivered email is stored once. Null for legacy and form rows. */
    messageId: text("message_id").unique(),
    inReplyTo: text("in_reply_to"),
    references: text("references"),
    occurredAt: tsMs("occurred_at").notNull().defaultNow(),
    status: messageStatus("status"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    aiDraft: text("ai_draft"),
    edited: boolean("edited"),
    idempotencyKey: text("idempotency_key").unique(),
  },
  (t) => [
    index("messages_ticket_occurred_idx").on(t.ticketId, t.occurredAt, t.id),
    check(
      "messages_direction_shape",
      sql`(${t.direction} = 'inbound' and ${t.authorId} is null and ${t.status} is null)
        or (${t.direction} = 'outbound' and ${t.status} is not null)`,
    ),
  ],
);

/**
 * Staff-only notes on a ticket. Deliberately a separate table from `messages`: the conversation
 * readers that feed AI prompts and outbound mail never see notes, and a note never touches
 * ticket ownership, status or the overdue clock.
 */
export const internalNotes = pgTable(
  "internal_notes",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: tsMs("created_at").notNull().defaultNow(),
  },
  (t) => [index("internal_notes_ticket_idx").on(t.ticketId, t.createdAt, t.id)],
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
export type TicketSource = (typeof ticketSource.enumValues)[number];
export type TicketStatus = (typeof ticketStatus.enumValues)[number];
export type TriageCategory = (typeof triageCategory.enumValues)[number];
export type TriageUrgency = (typeof triageUrgency.enumValues)[number];
export type MessageDirection = (typeof messageDirection.enumValues)[number];
export type MessageStatus = (typeof messageStatus.enumValues)[number];
export type TicketAssignedBy = (typeof ticketAssignedBy.enumValues)[number];

/** A staff user as shown next to tickets and replies (assignee, reply sender, assignee picker). */
export type UserRef = { id: number; name: string; email: string };

/** A help article the AI may cite; also what the article panel shows. */
export type HelpArticle = { id: string; title: string; body: string };
