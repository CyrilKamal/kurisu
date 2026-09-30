CREATE TYPE "public"."proposal_source" AS ENUM('agent', 'undo');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'committing', 'committed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" integer NOT NULL,
	"proposal_id" uuid NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_by_change_id" uuid,
	CONSTRAINT "changes_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" integer NOT NULL,
	"source" "proposal_source" NOT NULL,
	"run_id" uuid,
	"idempotency_key" text NOT NULL,
	"before" jsonb NOT NULL,
	"change" jsonb NOT NULL,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"confirmation_reason" text,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"undo_of_change_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_anime_id_anime_mal_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("mal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_undone_by_change_id_changes_id_fk" FOREIGN KEY ("undone_by_change_id") REFERENCES "public"."changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_anime_id_anime_mal_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("mal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_undo_of_change_id_changes_id_fk" FOREIGN KEY ("undo_of_change_id") REFERENCES "public"."changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changes_user_committed_idx" ON "changes" USING btree ("user_id","committed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_user_idempotency_key_idx" ON "proposals" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "proposals_user_created_idx" ON "proposals" USING btree ("user_id","created_at" DESC NULLS LAST);