#!/usr/bin/env bash
# Ships origin/main to the hosted kurisu. Run it from the hosted app's own checkout, which stays
# detached at origin/main (deploy/README.md):  bash deploy/deploy.sh
set -euo pipefail

# Everything runs from this function, so bash has read the whole script before the checkout
# below replaces it with main's copy.
main() {
  local root
  root="$(cd "$(dirname "$0")/.." && pwd)"
  cd "$root"

  if [ "$(git rev-parse --abbrev-ref HEAD)" != "HEAD" ]; then
    echo "This checkout is on a branch. Deploy from the hosted app's own checkout (deploy/README.md)." >&2
    exit 1
  fi
  if [ ! -f .env.prod ]; then
    echo ".env.prod is missing here: copy deploy/env.prod.example to .env.prod and fill it in." >&2
    exit 1
  fi

  git fetch --quiet origin main
  git checkout --quiet --detach origin/main
  docker compose -f deploy/compose.yaml --env-file .env.prod up -d --build --wait
  git log -1 --format='Deployed %h: %s'
}

main "$@"
