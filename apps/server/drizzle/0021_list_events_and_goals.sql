CREATE TYPE "public"."list_event_kind" AS ENUM('added', 'updated', 'removed');--> statement-breakpoint
CREATE TABLE "list_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"anime_id" integer NOT NULL,
	"kind" "list_event_kind" NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yearly_goals" (
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"target" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "yearly_goals_user_id_year_pk" PRIMARY KEY("user_id","year")
);
--> statement-breakpoint
ALTER TABLE "list_events" ADD CONSTRAINT "list_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_events" ADD CONSTRAINT "list_events_anime_id_anime_mal_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("mal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yearly_goals" ADD CONSTRAINT "yearly_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_events_user_at_idx" ON "list_events" USING btree ("user_id","at" DESC NULLS LAST);