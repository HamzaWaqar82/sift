CREATE TYPE "public"."ticket_assigned_by" AS ENUM('auto', 'admin', 'claim', 'system');--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "assigned_by" "ticket_assigned_by";--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "released_from_user_id" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "release_reason" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_released_from_user_id_users_id_fk" FOREIGN KEY ("released_from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;