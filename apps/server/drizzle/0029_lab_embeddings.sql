-- pgvector, for Milestone 7's lab. The database image ships it (pgvector/pgvector).
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."embedding_kind" AS ENUM('title', 'synopsis', 'history');--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "embedding_kind" NOT NULL,
	"ref" text NOT NULL,
	"user_id" uuid,
	"model" text NOT NULL,
	"text_hash" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_text_key" UNIQUE NULLS NOT DISTINCT("kind","model","ref","user_id")
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddings_vector_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);