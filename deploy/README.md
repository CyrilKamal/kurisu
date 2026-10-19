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

## Running on a server

The hosted app's server is a DigitalOcean droplet: Ubuntu 24.04, Basic, 2 GB RAM, about $12 a month. The same stack runs there, with the `public` compose profile, which adds two services:
- **`caddy`:** HTTPS on your own domain, with Let's Encrypt certificates, in front of the web app.
- **`offsite`:** copies the daily dumps to S3-compatible storage (DigitalOcean Spaces or Backblaze B2) every 6 hours, and keeps 30 days there.

Nothing else changes: `deploy/deploy.sh` deploys there the same way.

### Setting it up (once)

1. **Point the domain at the droplet.** Add an `A` record for the domain (or a subdomain) pointing to the droplet's IPv4 address. Wait until `nslookup <domain>` answers with that address.
2. **On the droplet** (`ssh root@<ip>`), install Docker, open the firewall, and add swap. Building the web app needs more than 2 GB of memory.
   ```bash
   curl -fsSL https://get.docker.com | sh
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   git clone https://github.com/CyrilKamal/kurisu.git /opt/kurisu
   cd /opt/kurisu && git checkout --detach origin/main
   ```
3. **Settings.**
   1. Copy the PC's `.env.prod` across: `scp .env.prod root@<ip>:/opt/kurisu/`, from `C:\Users\megar\repos\kurisu-prod`.
   2. Set the new address in `WEB_ORIGIN`, `MAL_REDIRECT_URI` and `KURISU_DOMAIN`.
   3. Set `COMPOSE_PROFILES=public`.
   4. Set the `BACKUP_S3_*` values (see `env.prod.example`).
4. **Move the data.** Stop the PC's stack first so nothing is written after the last dump:
   1. On the PC:
      ```bash
      docker compose -f deploy/compose.yaml --env-file .env.prod exec -T db sh -c 'pg_dump -Fc --exclude-schema=pgboss -U "$POSTGRES_USER" "$POSTGRES_DB"' > backups/kurisu-move.dump
      docker compose -f deploy/compose.yaml --env-file .env.prod stop
      ```
   2. Copy the dump to the droplet with `scp`.
   3. On the droplet:
      ```bash
      docker compose -f deploy/compose.yaml --env-file .env.prod up -d --wait db
      docker compose -f deploy/compose.yaml --env-file .env.prod exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < kurisu-move.dump
      bash deploy/deploy.sh
      ```
5. **Switch MAL over.** On the hosted MAL app's page (https://myanimelist.net/apiconfig), set the App Redirect URL to the new `MAL_REDIRECT_URI`.
6. **Check it.**
   - `curl https://<domain>/api/health/db` answers `{"status":"ok"}`.
   - Logging in works.
   - The uptime monitor watches `https://<domain>/api/health/db`.
7. **Retire the PC's copy.**
   - Run `tailscale funnel --bg off`.
   - Leave the stopped stack and its volume as a fallback for a while, then remove them.
   - The app's address changed, so install it again from the new address.

### Every deploy after that

```bash
ssh root@<ip> 'cd /opt/kurisu && bash deploy/deploy.sh'
```
