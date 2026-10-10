CREATE TYPE "public"."review_kind" AS ENUM('error', 'undone', 'report');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('new', 'exported', 'dismissed');--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "review_kind" NOT NULL,
	"note" text,
	"message" text NOT NULL,
	"history" jsonb NOT NULL,
	"reply" text NOT NULL,
	"list_snapshot" jsonb NOT NULL,
	"airing" jsonb NOT NULL,
	"status" "review_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_run_kind_idx" ON "review_items" USING btree ("run_id","kind");--> statement-breakpoint
CREATE INDEX "review_items_status_idx" ON "review_items" USING btree ("status","created_at" DESC NULLS LAST);