ALTER TABLE "tickets" ADD COLUMN "assigned_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_opened_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "overdue_since" timestamp (3) with time zone;