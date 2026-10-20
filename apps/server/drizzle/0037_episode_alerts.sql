CREATE TABLE "episode_alert_mutes" (
	"user_id" uuid NOT NULL,
	"mal_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_alert_mutes_user_id_mal_id_pk" PRIMARY KEY("user_id","mal_id")
);
--> statement-breakpoint
CREATE TABLE "episode_alerts" (
	"user_id" uuid NOT NULL,
	"mal_id" integer NOT NULL,
	"episode" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_alerts_user_id_mal_id_episode_pk" PRIMARY KEY("user_id","mal_id","episode")
);
--> statement-breakpoint
ALTER TABLE "brief_settings" ADD COLUMN "episode_alerts_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episode_alert_mutes" ADD CONSTRAINT "episode_alert_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_alert_mutes" ADD CONSTRAINT "episode_alert_mutes_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_alerts" ADD CONSTRAINT "episode_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_alerts" ADD CONSTRAINT "episode_alerts_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;