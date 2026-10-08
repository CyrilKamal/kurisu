CREATE TABLE "anilist_sequels" (
	"mal_id" integer PRIMARY KEY NOT NULL,
	"sequels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "alerts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "anilist_sequels" ADD CONSTRAINT "anilist_sequels_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;