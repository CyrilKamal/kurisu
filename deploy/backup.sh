#!/bin/sh
# Dumps the hosted database once a day into /backups and keeps the last 14 days.
# Runs in the compose stack's backup service; restore with pg_restore (deploy/README.md).
set -eu
# After a reboot Docker starts every container at once, and depends_on only orders `compose up`:
# wait for the database rather than failing the first dump and retrying an hour later.
tries=0
until pg_isready --quiet; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "backup: the database isn't up after 5 minutes; trying anyway" >&2
    break
  fi
  sleep 5
done
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
