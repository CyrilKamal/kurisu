ALTER TABLE "anime" ADD COLUMN "synopsis" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "welcomed_at" timestamp with time zone;--> statement-breakpoint
-- Everyone who already has an account has been using the app: only new accounts see the welcome steps.
UPDATE "users" SET "welcomed_at" = now();