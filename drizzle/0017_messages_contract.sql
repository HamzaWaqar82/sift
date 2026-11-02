-- Back-fill (hand-written): every write since 0004 also went to messages, but copy anything that
-- drifted before the old shape is dropped, so no ticket body or reply is lost. Only a drifted
-- reply (recorded as sent, never queued as a message) moves last_outbound_at.
UPDATE "tickets" t SET "last_outbound_at" = greatest(t."last_outbound_at", d."sent_at")
FROM (
  SELECT r."ticket_id", max(r."sent_at") AS "sent_at" FROM "replies" r
  WHERE NOT EXISTS (SELECT 1 FROM "messages" m WHERE m."idempotency_key" = r."idempotency_key")
  GROUP BY r."ticket_id"
) d WHERE d."ticket_id" = t."id";--> statement-breakpoint
INSERT INTO "messages" ("ticket_id", "direction", "author_id", "to_address", "subject", "body_text", "occurred_at", "status", "attempts", "ai_draft", "edited", "idempotency_key")
SELECT r."ticket_id", 'outbound', r."sent_by", t."customer_email", 'Re: ' || t."subject", r."final_body", r."sent_at", 'sent', 1, r."ai_draft", r."edited", r."idempotency_key"
FROM "replies" r JOIN "tickets" t ON t."id" = r."ticket_id"
WHERE NOT EXISTS (SELECT 1 FROM "messages" m WHERE m."idempotency_key" = r."idempotency_key");--> statement-breakpoint
INSERT INTO "messages" ("ticket_id", "direction", "from_address", "subject", "body_text", "occurred_at")
SELECT t."id", 'inbound', t."customer_email", t."subject", t."body", t."created_at" FROM "tickets" t
WHERE NOT EXISTS (SELECT 1 FROM "messages" m WHERE m."ticket_id" = t."id" AND m."direction" = 'inbound');--> statement-breakpoint
UPDATE "tickets" SET "last_inbound_at" = "created_at" WHERE "last_inbound_at" IS NULL;--> statement-breakpoint
DROP TABLE "replies" CASCADE;--> statement-breakpoint
ALTER TABLE "tickets" DROP COLUMN "body";
