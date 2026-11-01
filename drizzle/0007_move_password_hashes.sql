-- Existing bcrypt hashes become Better Auth credential accounts (account_id must equal users.id::text),
-- so every user keeps their password. All existing users are seeded staff, so they count as verified.
INSERT INTO "account" ("account_id", "provider_id", "user_id", "password")
SELECT "id"::text, 'credential', "id", "password_hash" FROM "users"
ON CONFLICT ("provider_id", "account_id") DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "email_verified" = true;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";
