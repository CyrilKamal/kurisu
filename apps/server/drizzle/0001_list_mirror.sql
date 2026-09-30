CREATE TYPE "public"."list_status" AS ENUM('watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('login', 'manual');--> statement-breakpoint
CREATE TABLE "anime" (
	"mal_id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"main_picture_url" text,
	"media_type" text,
	"num_episodes" integer,
	"airing_status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_entries" (
	"user_id" uuid NOT NULL,
	"anime_id" integer NOT NULL,
	"status" "list_status" NOT NULL,
	"score" integer NOT NULL,
	"num_episodes_watched" integer NOT NULL,
	"is_rewatching" boolean NOT NULL,
	"start_date" text,
	"finish_date" text,
	"mal_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "list_entries_user_id_anime_id_pk" PRIMARY KEY("user_id","anime_id")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"status" "sync_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"entries_count" integer,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_anime_id_anime_mal_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("mal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_runs_user_started_idx" ON "sync_runs" USING btree ("user_id","started_at" DESC NULLS LAST);