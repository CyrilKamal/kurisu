CREATE TYPE "public"."import_group" AS ENUM('add', 'update', 'up_to_date', 'disagree', 'which_one', 'not_found', 'not_a_show');--> statement-breakpoint
CREATE TYPE "public"."import_item_status" AS ENUM('pending', 'committed', 'failed', 'skipped', 'undone', 'undo_failed');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('parsing', 'review', 'running', 'done', 'undoing', 'undone', 'failed');--> statement-breakpoint
CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"position" integer NOT NULL,
	"line" text NOT NULL,
	"said" text NOT NULL,
	"title" text NOT NULL,
	"notes" jsonb NOT NULL,
	"group" "import_group" NOT NULL,
	"candidates" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"anime_id" integer,
	"mal_state" jsonb,
	"change" jsonb,
	"note" text,
	"checked" boolean DEFAULT false NOT NULL,
	"resolution" text,
	"proposal_id" uuid,
	"status" "import_item_status" DEFAULT 'pending' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" "import_status" DEFAULT 'parsing' NOT NULL,
	"error" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_items_import_idx" ON "import_items" USING btree ("import_id","line_no","position");--> statement-breakpoint
CREATE INDEX "imports_user_created_idx" ON "imports" USING btree ("user_id","created_at" DESC NULLS LAST);