CREATE TABLE "suppressed_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
