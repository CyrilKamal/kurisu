/**
 * The Postgres image the integration tests and the eval harness start (Testcontainers): Postgres
 * 18 with pgvector, the same image as docker-compose.yml and deploy/compose.yaml. One constant,
 * so the two can't drift apart.
 */
export const POSTGRES_IMAGE =
  "pgvector/pgvector:pg18-trixie@sha256:9d9c930220cb9bf2f956d10a8f909cf9973d9672ca0278aef2c1e6facccad2e0";
