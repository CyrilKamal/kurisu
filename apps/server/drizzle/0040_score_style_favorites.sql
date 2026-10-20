CREATE TYPE "public"."score_style" AS ENUM('point_10', 'point_100', 'stars_5');--> statement-breakpoint
CREATE TABLE "favorites" (
	"user_id" uuid NOT NULL,
	"anime_id" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_anime_id_pk" PRIMARY KEY("user_id","anime_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "score_style" "score_style" DEFAULT 'point_10' NOT NULL;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_anime_id_anime_mal_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;