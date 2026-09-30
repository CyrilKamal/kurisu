ALTER TABLE "anime" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "title_ja" text;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "synonyms" text[] DEFAULT '{}'::text[] NOT NULL;