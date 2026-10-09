#!/bin/sh
# Dumps the hosted database once a day into /backups and keeps the last 14 days.
# Runs in the compose stack's backup service; restore with pg_restore (deploy/README.md).
set -eu
while true; do
  file="/backups/kurisu-$(date -u +%Y-%m-%d).dump"
  # pg-boss's queue tables are left out: they hold only pending jobs, and the server recreates them.
  if pg_dump --format=custom --exclude-schema=pgboss --file="$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup: wrote $file"
  else
    rm -f "$file.tmp"
    echo "backup: pg_dump failed; trying again in an hour" >&2
    sleep 3600
    continue
  fi
  find /backups -name 'kurisu-*.dump' -mtime +14 -delete
  sleep 86400
done
