CREATE TABLE "show_cast" (
	"mal_id" integer PRIMARY KEY NOT NULL,
	"actors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "studios" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "broadcast_day" text;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "broadcast_time" text;--> statement-breakpoint
ALTER TABLE "show_cast" ADD CONSTRAINT "show_cast_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;