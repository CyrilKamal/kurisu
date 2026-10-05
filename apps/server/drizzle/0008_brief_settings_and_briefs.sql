CREATE TYPE "public"."brief_kind" AS ENUM('daily', 'test');--> statement-breakpoint
CREATE TYPE "public"."brief_status" AS ENUM('building', 'ready', 'sent', 'empty', 'skipped_late', 'failed');--> statement-breakpoint
CREATE TABLE "brief_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"local_time" text DEFAULT '08:00' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"services" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "brief_kind" NOT NULL,
	"local_date" text,
	"status" "brief_status" NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"items" jsonb,
	"summary" text,
	"summary_source" text,
	"model" text,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"summary_latency_ms" integer,
	"chat_message_id" uuid,
	"push_sent" integer,
	"push_failed" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brief_settings" ADD CONSTRAINT "brief_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "briefs_daily_user_date_idx" ON "briefs" USING btree ("user_id","local_date") WHERE "briefs"."kind" = 'daily';--> statement-breakpoint
CREATE INDEX "briefs_user_created_idx" ON "briefs" USING btree ("user_id","created_at" DESC NULLS LAST);