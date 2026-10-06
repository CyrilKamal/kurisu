CREATE TABLE "drop_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" integer NOT NULL,
	"category" text NOT NULL,
	"said" text NOT NULL,
	"change_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drop_reasons_change_id_unique" UNIQUE("change_id")
);
--> statement-breakpoint
CREATE TABLE "taste_genres" (
	"user_id" uuid NOT NULL,
	"genre" text NOT NULL,
	"scored" integer NOT NULL,
	"mean_score" real,
	"dropped" integer NOT NULL,
	"affinity" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taste_genres_user_id_genre_pk" PRIMARY KEY("user_id","genre")
);
--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "genres" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "episode_minutes" integer;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "mal_mean" real;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "drop_reason" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "drop_said" text;--> statement-breakpoint
ALTER TABLE "drop_reasons" ADD CONSTRAINT "drop_reasons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_reasons" ADD CONSTRAINT "drop_reasons_anime_id_anime_mal_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("mal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_reasons" ADD CONSTRAINT "drop_reasons_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_genres" ADD CONSTRAINT "taste_genres_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drop_reasons_user_idx" ON "drop_reasons" USING btree ("user_id","created_at" DESC NULLS LAST);