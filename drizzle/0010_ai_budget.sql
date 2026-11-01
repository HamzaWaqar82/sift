CREATE TYPE "public"."ai_call_outcome" AS ENUM('pending', 'ok', 'invalid', 'rate_limited', 'error');--> statement-breakpoint
CREATE TYPE "public"."triage_state" AS ENUM('queued', 'running', 'done', 'waiting_rate_limit', 'daily_cap_reached', 'failed');--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"lane" text NOT NULL,
	"ticket_id" integer,
	"model" text NOT NULL,
	"outcome" "ai_call_outcome" DEFAULT 'pending' NOT NULL,
	"detail" text,
	"started_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_triage" (
	"ticket_id" integer PRIMARY KEY NOT NULL,
	"state" "triage_state" NOT NULL,
	"retry_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_triage" ADD CONSTRAINT "ticket_triage_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_started_at_idx" ON "ai_calls" USING btree ("started_at");