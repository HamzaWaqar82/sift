CREATE TYPE "public"."ticket_source" AS ENUM('webhook', 'form');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'replied', 'closed');--> statement-breakpoint
CREATE TYPE "public"."triage_category" AS ENUM('billing', 'technical', 'account', 'feature_request', 'other');--> statement-breakpoint
CREATE TYPE "public"."triage_urgency" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"ai_draft" text,
	"final_body" text NOT NULL,
	"sent_by" integer NOT NULL,
	"sent_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"edited" boolean NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "replies_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_email" text NOT NULL,
	"customer_name" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"source" "ticket_source" NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"assignee_id" integer,
	"external_message_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_external_message_id_unique" UNIQUE("external_message_id")
);
--> statement-breakpoint
CREATE TABLE "triage_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"category" "triage_category",
	"urgency" "triage_urgency",
	"draft" text,
	"article_id" text,
	"error" text,
	"raw_output" text,
	"model" text NOT NULL,
	"requested_by" integer,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_results_valid_or_error" CHECK (("triage_results"."error" is null and "triage_results"."category" is not null and "triage_results"."urgency" is not null and "triage_results"."draft" is not null)
        or ("triage_results"."error" is not null and "triage_results"."category" is null and "triage_results"."urgency" is null and "triage_results"."draft" is null and "triage_results"."article_id" is null))
);
--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_results" ADD CONSTRAINT "triage_results_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_results" ADD CONSTRAINT "triage_results_article_id_help_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."help_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_results" ADD CONSTRAINT "triage_results_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replies_ticket_sent_idx" ON "replies" USING btree ("ticket_id","sent_at");--> statement-breakpoint
CREATE INDEX "tickets_created_at_id_idx" ON "tickets" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_status_created_at_id_idx" ON "tickets" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "triage_results_ticket_created_idx" ON "triage_results" USING btree ("ticket_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);