ALTER TABLE "list_entries" ADD COLUMN "comments" text;--> statement-breakpoint
ALTER TABLE "list_entries" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "list_entries" ADD COLUMN "priority" integer;--> statement-breakpoint
ALTER TABLE "list_entries" ADD COLUMN "times_rewatched" integer;