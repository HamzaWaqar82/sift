CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'bounced');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"direction" "message_direction" NOT NULL,
	"author_id" integer,
	"from_address" text,
	"to_address" text,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"message_id" text,
	"in_reply_to" text,
	"references" text,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"status" "message_status",
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"ai_draft" text,
	"edited" boolean,
	"idempotency_key" text,
	CONSTRAINT "messages_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "messages_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "messages_direction_shape" CHECK (("messages"."direction" = 'inbound' and "messages"."author_id" is null and "messages"."status" is null)
        or ("messages"."direction" = 'outbound' and "messages"."status" is not null))
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "last_inbound_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "last_outbound_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_ticket_occurred_idx" ON "messages" USING btree ("ticket_id","occurred_at","id");--> statement-breakpoint
-- Back-fill (hand-written): each ticket body becomes its first inbound message, each reply a sent outbound message.
INSERT INTO "messages" ("ticket_id", "direction", "from_address", "subject", "body_text", "message_id", "occurred_at")
SELECT "id", 'inbound', "customer_email", "subject", "body", "external_message_id", "created_at" FROM "tickets";--> statement-breakpoint
INSERT INTO "messages" ("ticket_id", "direction", "author_id", "to_address", "subject", "body_text", "occurred_at", "status", "attempts", "ai_draft", "edited", "idempotency_key")
SELECT r."ticket_id", 'outbound', r."sent_by", t."customer_email", 'Re: ' || t."subject", r."final_body", r."sent_at", 'sent', 1, r."ai_draft", r."edited", r."idempotency_key"
FROM "replies" r JOIN "tickets" t ON t."id" = r."ticket_id";--> statement-breakpoint
UPDATE "tickets" t SET "last_inbound_at" = t."created_at",
  "last_outbound_at" = (SELECT max(r."sent_at") FROM "replies" r WHERE r."ticket_id" = t."id");