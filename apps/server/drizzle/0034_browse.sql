CREATE TABLE "schedule_slots" (
	"anilist_id" integer NOT NULL,
	"episode" integer NOT NULL,
	"airing_at" timestamp with time zone NOT NULL,
	"mal_id" integer NOT NULL,
	"popularity" integer,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "schedule_slots_anilist_id_episode_pk" PRIMARY KEY("anilist_id","episode")
);
--> statement-breakpoint
CREATE TABLE "season_charts" (
	"season" text NOT NULL,
	"mal_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "season_charts_season_mal_id_pk" PRIMARY KEY("season","mal_id")
);
--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_charts" ADD CONSTRAINT "season_charts_mal_id_anilist_catalog_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anilist_catalog"("mal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_slots_airing_at_idx" ON "schedule_slots" USING btree ("airing_at");