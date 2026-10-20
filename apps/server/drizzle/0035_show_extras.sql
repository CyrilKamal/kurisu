CREATE TABLE "show_extras" (
	"mal_id" integer PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "show_extras" ADD CONSTRAINT "show_extras_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;