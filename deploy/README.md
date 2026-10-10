# Hosting kurisu

The hosted kurisu runs on Cyril's PC as a Docker Compose stack, published to the internet over HTTPS by Tailscale Funnel at `https://<pc>.<tailnet>.ts.net`. Nothing here costs money. The same stack runs on any Linux server with Docker, so moving to a VPS later is a copy (see the end).

| Service | What it is | Reachable at |
| --- | --- | --- |
| `db` | Postgres 18, its own volume, apart from the dev database | `127.0.0.1:5433` (this PC only) |
| `server` | the Fastify server, built from `apps/server`; applies migrations when it starts | inside the stack only |
| `web` | the Next.js app, which proxies `/api/*` to `server` | `127.0.0.1:3080`, which Funnel publishes |
| `backup` | a daily `pg_dump` into `BACKUP_DIR`, keeping 14 days | |

Every service restarts on its own, including after a reboot, as long as Docker Desktop starts when you sign in.

## The hosted app's own checkout

The hosted app builds from its own checkout, `C:\Users\megar\repos\kurisu-prod`, which stays detached at `origin/main`. So nothing in the dev checkout ships until it's merged. Its `.env.prod` lives there too.

Create it once, from the dev checkout:

```bash
git worktree add --detach ../kurisu-prod origin/main
```

Then copy `deploy/env.prod.example` to `../kurisu-prod/.env.prod` and fill it in. Each line says what goes there.

## First deploy

1. Copy the dev data across, once, before the first deploy: `bash deploy/copy-dev-data.sh` (in `kurisu-prod`). It copies the dev database (container `kurisu-db-1`) into the hosted one. It then drops MAL tokens, sessions, push subscriptions and pending logins, since they belong to the dev keys and the dev MAL app. Skip this step to start empty.
2. Deploy: `bash deploy/deploy.sh`.
3. Publish it: `tailscale funnel --bg 3080`. The `--bg` setting persists across reboots; `tailscale funnel status` shows it, and `tailscale funnel --https=443 off` turns it off.
4. Open `WEB_ORIGIN`, log in with MAL, then install the app from the browser's menu ("Add to Home Screen" on iPhone) and turn on notifications under Brief.

## Every deploy after that

```bash
bash deploy/deploy.sh
```

The database runs `pgvector/pgvector:pg18-trixie` (Postgres 18 with pgvector, on the same Debian as `postgres:18`, so the data directory carries over when the image changes; check a backup restores into a new image before switching). It fetches `main`, checks it out, rebuilds the images and restarts what changed. It refuses to run in a checkout that's on a branch, so it can't move the dev checkout off `main`. A deploy takes a few minutes; the app is down for the seconds the containers swap.

## Looking at it

From `kurisu-prod`:

```bash
docker compose -f deploy/compose.yaml --env-file .env.prod ps
docker compose -f deploy/compose.yaml --env-file .env.prod logs -f server
```

## Backups and restoring

`backup` writes `kurisu-YYYY-MM-DD.dump` into `BACKUP_DIR` (default `backups/` beside the checkout) when it starts and every 24 hours after, and deletes dumps older than 14 days. Point `BACKUP_DIR` at a synced folder to keep a copy off this PC. Dumps leave out pg-boss's queue tables (`pgboss` schema), which only hold pending jobs; the server recreates them.

To restore one, stop the app, restore into the database, and start it again:

```bash
docker compose -f deploy/compose.yaml --env-file .env.prod stop server web
docker compose -f deploy/compose.yaml --env-file .env.prod exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/kurisu-YYYY-MM-DD.dump
docker compose -f deploy/compose.yaml --env-file .env.prod start server web
```

## Things to know

- **While the PC sleeps or is off, kurisu is down.** Briefs due in that time go out when it's back (once per day per person). Windows' sleep setting is the main thing to change.
- **Dev and hosted share your MAL list.** The dev app still writes to your real MAL, so a change made there reaches the hosted app as a change "on MAL's site" at its next sync, not as a kurisu change with Undo. Use the hosted app for real life, and the fake MAL (`pnpm --filter @kurisu/server dev:fake-mal`) for development.
- **Funnel addresses are public.** They appear in certificate logs, so anyone can find the address. Only the owner (`OWNER_MAL_USERNAME`) and people who already have an account can log in.

## Moving to a VPS

On a Linux server with Docker: clone the repo, copy `.env.prod` across with a new `WEB_ORIGIN` and `MAL_REDIRECT_URI` (and the MAL app's redirect URL to match), restore the latest backup into a fresh `db`, then run `bash deploy/deploy.sh` and put a reverse proxy with HTTPS (Caddy, say) in front of port 3080. The address changes, so everyone reinstalls the app once.
