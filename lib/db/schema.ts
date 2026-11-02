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
export const ticketSource = pgEnum("ticket_source", ["webhook", "form", "email"]);
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
export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
/** How a ticket got its current owner (null while unowned or for owners set before ticket 19). */
export const ticketAssignedBy = pgEnum("ticket_assigned_by", ["auto", "admin", "claim", "system"]);
export const messageStatus = pgEnum("message_status", ["queued", "sending", "sent", "failed", "bounced"]);

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

/** A customer conversation. A form submission or an unmatched inbound email starts one; replies thread in (lib/inbound). */
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
    /** When the current owner got the ticket; the ack timeout counts from here for auto assignments. */
    assignedAt: tsMs("assigned_at"),
    /** When the owner first opened the ticket since it was auto-assigned to them. */
    firstOpenedAt: tsMs("first_opened_at"),
    /** Set by the overdue sweep when it releases the ticket; cleared once it stops being overdue. */
    overdueSince: tsMs("overdue_since"),
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

export const aiCallOutcome = pgEnum("ai_call_outcome", ["pending", "ok", "invalid", "rate_limited", "error"]);
export type AiCallOutcome = (typeof aiCallOutcome.enumValues)[number];
/** `manual`: an agent's Triage click. `auto`: background triage of new tickets (ticket 18). */
export type AiLane = "manual" | "auto";

/**
 * Every provider call the limiter let through (lib/triage/limiter.ts). Rows in the last minute
 * are the per-minute window; the admin AI panel lists them. Kept when the ticket is deleted.
 */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: serial("id").primaryKey(),
    lane: text("lane").$type<AiLane>().notNull(),
    ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    outcome: aiCallOutcome("outcome").notNull().default("pending"),
    detail: text("detail"),
    startedAt: tsMs("started_at").notNull(),
    finishedAt: tsMs("finished_at"),
  },
  (t) => [index("ai_calls_started_at_idx").on(t.startedAt)],
);

/**
 * Stored triage state per ticket (no row = never requested). `superseded` ("Out of date") is
 * not stored: it is a `done` triage older than the customer's latest message (lib/triage/state.ts).
 */
export const triageState = pgEnum("triage_state", [
  "queued",
  "running",
  "done",
  "waiting_rate_limit",
  "daily_cap_reached",
  "failed",
]);
export type StoredTriageState = (typeof triageState.enumValues)[number];

export const ticketTriage = pgTable("ticket_triage", {
  ticketId: integer("ticket_id")
    .primaryKey()
    .references(() => tickets.id, { onDelete: "cascade" }),
  state: triageState("state").notNull(),
  /** When a waiting job runs again (waiting_rate_limit, daily_cap_reached). */
  retryAt: tsMs("retry_at"),
  updatedAt: tsMs("updated_at").notNull().defaultNow(),
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

/**
 * Addresses we must not mail (bounced, or added by hand). Emails are stored lowercased; sending
 * to one is refused before anything is queued.
 */
export const suppressedEmails = pgTable("suppressed_emails", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: tsMs("created_at").notNull().defaultNow(),
});

/**
 * Every bounce notice we received, matched or not. Bounces never become tickets, so this is where
 * one is kept (an unmatched bounce is not thrown away silently) and where a redelivery is deduped.
 */
export const inboundBounces = pgTable("inbound_bounces", {
  id: serial("id").primaryKey(),
  /** The bounce notice's own Message-ID. */
  messageId: text("message_id").notNull().unique(),
  /** The outbound message it reports on; null when no sent message matched. */
  outboundMessageId: integer("outbound_message_id").references(() => messages.id, { onDelete: "set null" }),
  recipient: text("recipient"),
  diagnostic: text("diagnostic"),
  receivedAt: tsMs("received_at").notNull().defaultNow(),
});

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
export type UserAvailability = (typeof userAvailability.enumValues)[number];
export type TicketSource = (typeof ticketSource.enumValues)[number];
export type TicketStatus = (typeof ticketStatus.enumValues)[number];
export type TriageCategory = (typeof triageCategory.enumValues)[number];
export type TriageUrgency = (typeof triageUrgency.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
export type MessageDirection = (typeof messageDirection.enumValues)[number];
export type MessageStatus = (typeof messageStatus.enumValues)[number];
export type TicketAssignedBy = (typeof ticketAssignedBy.enumValues)[number];

/** A staff user as shown next to tickets and replies (assignee, reply sender, assignee picker). */
export type UserRef = { id: number; name: string; email: string };

/** A help article the AI may cite; also what the article panel shows. */
export type HelpArticle = { id: string; title: string; body: string };

/**
 * An admin's invitation to join (lib/invitations). Only the SHA-256 of the emailed token is stored;
 * `nonce` lets the mail job rebuild the same link without the plaintext ever being written down.
 * Pending means not accepted, not revoked and not expired.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    role: userRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    nonce: text("nonce").notNull(),
    invitedBy: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tsMs("created_at").notNull().defaultNow(),
    expiresAt: tsMs("expires_at").notNull(),
    acceptedAt: tsMs("accepted_at"),
    revokedAt: tsMs("revoked_at"),
  },
  (t) => [index("invitations_email_idx").on(t.email)],
);

export const accountTokenPurpose = pgEnum("account_token_purpose", ["password_reset", "email_change"]);

/**
 * Emailed one-time links: a password reset (1 hour) or confirming a new email address. Only the
 * SHA-256 of the token is stored; the token is rebuilt from id and nonce (lib/auth/account-tokens.ts).
 */
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: accountTokenPurpose("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    nonce: text("nonce").notNull(),
    /** The address being confirmed (email change only). */
    newEmail: text("new_email"),
    createdAt: tsMs("created_at").notNull().defaultNow(),
    expiresAt: tsMs("expires_at").notNull(),
    usedAt: tsMs("used_at"),
  },
  (t) => [index("account_tokens_user_idx").on(t.userId)],
);
