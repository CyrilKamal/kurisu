CREATE TABLE "anilist_catalog" (
	"mal_id" integer PRIMARY KEY NOT NULL,
	"anilist_id" integer NOT NULL,
	"title" text NOT NULL,
	"title_en" text,
	"title_ja" text,
	"synonyms" text[] DEFAULT '{}'::text[] NOT NULL,
	"media_type" text,
	"airing_status" text,
	"num_episodes" integer,
	"episode_minutes" integer,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"score" real,
	"popularity" integer,
	"cover_url" text,
	"start_date" text,
	"prequel_mal_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery" (
	"user_id" uuid NOT NULL,
	"mal_id" integer NOT NULL,
	"strength" real NOT NULL,
	"because" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "discovery_user_id_mal_id_pk" PRIMARY KEY("user_id","mal_id")
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	"shows" integer NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "discovery" ADD CONSTRAINT "discovery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;