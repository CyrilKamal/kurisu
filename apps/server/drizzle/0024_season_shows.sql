CREATE TABLE "season_shows" (
	"mal_id" integer PRIMARY KEY NOT NULL,
	"anilist_id" integer NOT NULL,
	"season" text NOT NULL,
	"rank" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
