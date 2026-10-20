CREATE TABLE "top_charts" (
	"chart" text NOT NULL,
	"mal_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "top_charts_chart_mal_id_pk" PRIMARY KEY("chart","mal_id")
);
--> statement-breakpoint
ALTER TABLE "top_charts" ADD CONSTRAINT "top_charts_mal_id_anilist_catalog_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anilist_catalog"("mal_id") ON DELETE cascade ON UPDATE no action;