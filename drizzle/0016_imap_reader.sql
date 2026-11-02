CREATE TABLE "imap_failures" (
	"uid_validity" text NOT NULL,
	"uid" bigint NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"first_failed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_failed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_error" text NOT NULL,
	"gave_up_at" timestamp (3) with time zone,
	CONSTRAINT "imap_failures_uid_validity_uid_pk" PRIMARY KEY("uid_validity","uid")
);
--> statement-breakpoint
CREATE TABLE "imap_state" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"uid_validity" text NOT NULL,
	"last_uid" bigint DEFAULT 0 NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"status_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
