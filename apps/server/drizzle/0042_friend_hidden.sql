CREATE TABLE "friend_hidden" (
	"user_id" uuid NOT NULL,
	"mal_id" integer NOT NULL,
	"hidden" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_hidden_user_id_mal_id_pk" PRIMARY KEY("user_id","mal_id")
);
--> statement-breakpoint
ALTER TABLE "friend_hidden" ADD CONSTRAINT "friend_hidden_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_hidden" ADD CONSTRAINT "friend_hidden_mal_id_anime_mal_id_fk" FOREIGN KEY ("mal_id") REFERENCES "public"."anime"("mal_id") ON DELETE cascade ON UPDATE no action;