CREATE TABLE "friend_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"code_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_links_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_user_a_user_b_pk" PRIMARY KEY("user_a","user_b"),
	CONSTRAINT "friendships_ordered" CHECK ("friendships"."user_a" < "friendships"."user_b")
);
--> statement-breakpoint
ALTER TABLE "diary_notes" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "share_activity" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_links" ADD CONSTRAINT "friend_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friendships_user_b_idx" ON "friendships" USING btree ("user_b");--> statement-breakpoint
-- Whoever already joined with an invite becomes friends with the person who invited them.
INSERT INTO "friendships" ("user_a", "user_b", "via", "created_at")
SELECT LEAST("created_by", "used_by"), GREATEST("created_by", "used_by"), 'invite', "used_at"
FROM "invites"
WHERE "used_by" IS NOT NULL AND "used_by" <> "created_by"
ON CONFLICT DO NOTHING;
