CREATE TYPE "public"."write_kind" AS ENUM('update', 'add', 'remove');--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "before" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "changes" ADD COLUMN "kind" "write_kind" DEFAULT 'update' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "kind" "write_kind" DEFAULT 'update' NOT NULL;