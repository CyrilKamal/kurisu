CREATE TABLE "airing_episodes" (
	"mal_id" integer NOT NULL,
	"episode" integer NOT NULL,
	"airing_at" timestamp with time zone NOT NULL,
	CONSTRAINT "airing_episodes_mal_id_episode_pk" PRIMARY KEY("mal_id","episode")
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone,
	CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "airing_episodes" ADD CONSTRAINT "airing_episodes_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "airing_episodes_airing_at_idx" ON "airing_episodes" USING btree ("airing_at");