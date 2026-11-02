ALTER TYPE "public"."ticket_source" ADD VALUE 'email';--> statement-breakpoint
CREATE TABLE "inbound_bounces" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"outbound_message_id" integer,
	"recipient" text,
	"diagnostic" text,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_bounces_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "inbound_bounces" ADD CONSTRAINT "inbound_bounces_outbound_message_id_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;