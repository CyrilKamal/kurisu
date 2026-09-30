# kurisu

A personal anime agent. Tell it what you watched in plain language, and it keeps your MyAnimeList list in sync, sends a daily brief of new episodes, and recommends what to watch next from your backlog. It ships as an installable web app (PWA).

- Design: [docs/design.md](docs/design.md)
- Decision log: [docs/decisions.md](docs/decisions.md)

Status: Milestone 1 (MAL login, list mirror, List screen) in progress.

## Development

Requires Node 24, pnpm 12 and Docker Desktop.

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm db:up                   # local Postgres
pnpm db:migrate              # create/upgrade tables
pnpm dev                     # server on :4000, web on :3000
```

`pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` run across the workspace. Integration tests start their own Postgres container, so Docker must be running.

Layout:

- `apps/web`: Next.js PWA (App Router). Proxies `/api/*` to the server.
- `apps/server`: Fastify service that holds MAL tokens and talks to Postgres.
- `packages/shared`: the API contract (zod schemas) the web app and server tests share.

## License

[MIT](LICENSE)
