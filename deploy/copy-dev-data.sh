#!/usr/bin/env bash
# One time, before the hosted app's first deploy: copies the dev database (docker-compose.yml's
# db, container kurisu-db-1) into the hosted one. It then drops what belongs to the dev setup:
# MAL tokens (the dev MAL app and key), sessions, push subscriptions and pending logins. So
# everyone logs in again on the hosted app, and turns notifications on again.
#   bash deploy/copy-dev-data.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dev="${DEV_DB_CONTAINER:-kurisu-db-1}"
compose=(docker compose -f "$root/deploy/compose.yaml" --env-file "$root/.env.prod")

"${compose[@]}" up -d --wait db
prod="$("${compose[@]}" ps -q db)"

# psql inside a container, as that container's own database user.
psql_in() {
  local container="$1"
  shift
  docker exec -i "$container" sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
}

if [ "$(psql_in "$prod" -tAc "select to_regclass('public.users') is not null")" = "t" ]; then
  echo "The hosted database already has kurisu's tables; not copying over them." >&2
  exit 1
fi

# pg-boss's queue tables stay behind; the hosted server creates its own.
docker exec "$dev" sh -c 'pg_dump --no-owner --no-acl --exclude-schema=pgboss -U "$POSTGRES_USER" -d "$POSTGRES_DB"' |
  psql_in "$prod" >/dev/null

psql_in "$prod" -c "delete from mal_tokens; delete from sessions; delete from push_subscriptions; delete from oauth_states;"
psql_in "$prod" -tAc "select 'Copied ' || count(*) || ' account(s): ' || string_agg(mal_username, ', ') from users"
