ALTER TABLE "brief_settings" ADD COLUMN "sunday_recap" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "recap" jsonb;