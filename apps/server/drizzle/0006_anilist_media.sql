CREATE TABLE "anilist_media" (
	"mal_id" integer PRIMARY KEY NOT NULL,
	"anilist_id" integer,
	"status" text,
	"episodes" integer,
	"next_episode" integer,
	"next_airing_at" timestamp with time zone,
	"streaming_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anilist_media" ADD CONSTRAINT "anilist_media_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anilist_media_anilist_id_idx" ON "anilist_media" USING btree ("anilist_id");