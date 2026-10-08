CREATE TABLE "diary_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" integer NOT NULL,
	"change_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_notes_change_id_unique" UNIQUE("change_id")
);
--> statement-breakpoint
ALTER TABLE "diary_notes" ADD CONSTRAINT "diary_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_notes" ADD CONSTRAINT "diary_notes_anime_id_anime_mal_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("mal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_notes" ADD CONSTRAINT "diary_notes_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_notes_user_idx" ON "diary_notes" USING btree ("user_id","created_at" DESC NULLS LAST);