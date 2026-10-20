CREATE TYPE "public"."title_language" AS ENUM('romaji', 'english', 'japanese');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title_language" "title_language" DEFAULT 'romaji' NOT NULL;