# Decision log

Newest at the bottom. Entries are never edited or deleted; a reversal gets a new entry that references the old one.

## 2026-09-29 — Ship as a PWA, not a native app (Pre-build)
**Decision:** Build an installable Next.js PWA first.
**Alternatives:** React Native/Expo from day one; a Discord bot.
**Why:** One codebase for desktop and phone, with home-screen install and web push, which is all the morning brief needs.
**Consequences:** iOS push requires the app to be added to the home screen. A native wrapper can come later.

## 2026-09-29 — MyAnimeList as the list of record (Pre-build)
**Decision:** Sync with MAL via its official API v2.
**Alternatives:** AniList as the primary list.
**Why:** MAL is the list I actually use.
**Consequences:** MAL has no episode-level schedule, so AniList supplies airing data. MAL OAuth needs a hand-rolled `plain` PKCE flow.

## 2026-09-29 — Proposal-then-commit for all MAL writes (Pre-build)
**Decision:** The model stages changes with `propose_update`; only `commit_update` with a proposal ID writes to MAL.
**Alternatives:** Letting the model call a write tool directly with raw arguments.
**Why:** Wrong writes are the fastest way to lose trust. This makes every write reviewable, idempotent and undoable.
**Consequences:** One extra tool round-trip per update; a proposals table in Postgres.

## 2026-09-29 — Gemini free tier plus local Ollama for dev (Pre-build)
**Decision:** Gemini Flash-Lite for parsing and sync, Gemini Flash for recommendations, a local Ollama model for eval runs, all behind one provider interface.
**Alternatives:** Hosted open-weight models (Qwen3.6-35B-A3B, gpt-oss-120b) on a paid provider.
**Why:** Zero spend during development. Local eval runs avoid free-tier rate limits.
**Consequences:** Free-tier prompts may be used by Google, so only my own data goes through it. Move to a paid tier before the friends beta.

## 2026-09-29 — Streaming availability from AniList links + user's services (Pre-build)
**Decision:** Use AniList external links, filtered to the services the user says they have; say nothing when there's no match.
**Alternatives:** TMDB watch providers (region-aware, needs MAL-to-TMDB mapping).
**Why:** Free, uses an API we already call, and is never confidently wrong.
**Consequences:** Not region-aware. TMDB can be added later if the where-to-watch line matters.

## 2026-09-29 — TypeScript end to end, Python only for fine-tuning (Pre-build)
**Decision:** TypeScript for the PWA and agent backend; Python confined to `ml/` for Milestone 6.
**Alternatives:** Python backend (FastAPI).
**Why:** One language and toolchain for the product; Python only where its ML ecosystem is needed.
**Consequences:** The eval harness is written in TypeScript.

## 2026-09-29 — Public GitHub repo, PR-only main (Milestone 1)
**Decision:** Host at github.com/CyrilKamal/kurisu as a public repo. `main` changes only through squash-merged PRs from short-lived branches, gated by CI, with Conventional Commit messages and LF line endings enforced by `.gitattributes`.
**Alternatives:** Keep it private with the workflow followed by convention only (rulesets on private repos need GitHub Pro); commit straight to `main`.
**Why:** Public repos get enforced rulesets and free secret scanning with push protection, and the repo doubles as a showcase. Small PRs keep each change reviewable.
**Consequences:** Nothing sensitive can ever be committed: `.env.local` and real list data stay out, and gitleaks runs in CI as a backstop. Every change needs a PR, which adds a little overhead for a solo project.

## 2026-09-29 — pnpm workspaces monorepo (Milestone 1)
**Decision:** One repo with pnpm workspaces: `apps/web` (Next.js) and `apps/server` (agent backend), with shared packages under `packages/` added only when something is actually shared.
**Alternatives:** npm workspaces; two separate repos.
**Why:** pnpm's strict dependency isolation stops apps from importing packages they didn't declare, and it is the de facto monorepo tool. One repo keeps API changes and their UI in the same PR.
**Consequences:** Contributors need pnpm 12 (pinned via `packageManager`). Each app owns its own lint/test config.

## 2026-09-29 — Fastify for the agent backend (Milestone 1)
**Decision:** Fastify 5, built through a `buildApp(config)` factory; tests drive it with `app.inject` and never open a port.
**Alternatives:** Hono; Express; Next.js route handlers only.
**Why:** Mature, fast, first-class TypeScript and pino structured logging (which Milestone 2's run logs build on). A long-running Node process also suits the scheduled jobs in Milestone 3, which serverless route handlers don't.
**Consequences:** A second process to run in dev (`pnpm dev` starts both). Hosting later needs a long-lived Node host, not just a serverless platform.

## 2026-09-29 — Toolchain pins: TypeScript 6.0, ESLint 10 on server and 9 on web (Milestone 1)
**Decision:** Pin TypeScript to `~6.0.3`. Lint the server with ESLint 10 and the web app with ESLint 9. Both use typescript-eslint's `strictTypeChecked` rules plus Prettier for formatting.
**Alternatives:** TypeScript 7 (the native port); ESLint 10 everywhere via the `@eslint/compat` shim; Biome instead of ESLint + Prettier.
**Why:** typescript-eslint supports TypeScript only below 6.1, and type-aware lint rules matter more than TS 7's compile speed at this size. ESLint 9 is out of support, but `eslint-config-next` pulls in eslint-plugin-react/-import/-jsx-a11y, which crash on ESLint 10. The compat shim then collides with typescript-eslint's plugin registration. Next's own template still ships ESLint 9.
**Consequences:** The web app runs an out-of-support dev-only linter. Move it to ESLint 10 once `eslint-config-next` supports it, and move to TS 7 once typescript-eslint does. Dependabot will surface both.

## 2026-09-29 — Vitest for tests (Milestone 1)
**Decision:** Vitest for unit and integration tests.
**Alternatives:** Jest; Node's built-in test runner.
**Why:** Native ESM and TypeScript with no transform config, fast watch mode, and a Jest-compatible API.
**Consequences:** Vitest 5 requires Node 22.12+ or 24, which matches our Node 24 pin.

## 2026-09-29 — Tailwind CSS for styling (Milestone 1)
**Decision:** Tailwind CSS 4 via its PostCSS plugin.
**Alternatives:** CSS Modules; a component library.
**Why:** Fast to build a small mobile-first UI with no design system to maintain; it is Next's default.
**Consequences:** Styling lives in class names in JSX. Revisit a component library if the UI grows past two screens.

## 2026-09-29 — Local Postgres 18 via Docker Compose (Milestone 1)
**Decision:** `docker-compose.yml` runs `postgres:18` (pinned by digest), bound to 127.0.0.1 only, with credentials from `.env.local`.
**Alternatives:** A native Postgres install; a hosted dev database.
**Why:** Reproducible, one command, no system install, and the same major version the tests will run against.
**Consequences:** Requires Docker Desktop. Postgres only applies `POSTGRES_*` when it first creates the volume, so changing them later means `docker compose down -v`.

## 2026-09-29 — Web reaches the backend through a same-origin /api proxy (Milestone 1)
**Decision:** Next.js `rewrites` proxy `/api/*` to the Fastify server. `next.config.ts` reads only `API_INTERNAL_URL` from the root `.env.local`.
**Alternatives:** The browser calls the server cross-origin with CORS and credentialed cookies; duplicating endpoints as Next route handlers.
**Why:** The session cookie stays first-party and CORS never comes up. The MAL redirect URI can live on the web origin. Loading only one variable keeps server secrets (MAL client secret, encryption key) out of the Next.js process.
**Consequences:** Every API call takes one extra local hop. The rewrite destination is fixed at build time, so production builds need `API_INTERNAL_URL` set.

## 2026-09-29 — CI and supply-chain hardening (Milestone 1)
**Decision:** GitHub Actions runs format, lint, typecheck, test, build and a gitleaks history scan on every PR. Actions and container images are pinned to commit SHAs or digests. pnpm refuses package versions less than a day old (`minimumReleaseAge`). Dependabot waits 7 days before proposing updates.
**Alternatives:** Tag-pinned actions; relying on GitHub push protection alone; no release-age delay.
**Why:** Pinning and release-age delays blunt compromised-package attacks, which usually get caught within days. gitleaks backs up push protection with rules that also catch generic secrets.
**Consequences:** Brand-new releases can't be installed for a day. Dependabot PRs arrive a week behind releases, which is fine for a personal project.
