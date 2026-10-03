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

## 2026-09-29 — Drizzle ORM with generated SQL migrations (Milestone 1)
**Decision:** Drizzle ORM (0.45, stable line) on node-postgres. Schema lives in `apps/server/src/db/schema.ts`; drizzle-kit generates plain SQL migrations into `apps/server/drizzle/`, applied by our own `pnpm db:migrate` runner.
**Alternatives:** Prisma; Kysely + node-pg-migrate; raw SQL.
**Why:** Types come straight from the TypeScript schema, with no codegen step or engine binary. Queries stay close to SQL, and migrations are reviewable SQL files. Drizzle 1.0 is still in beta, so we stay on the stable line.
**Consequences:** Migrations are forward-only, so fixes go in a new migration. Moving to Drizzle 1.0 later will need an upgrade pass.

## 2026-09-29 — OAuth flow and session design (Milestone 1)
**Decision:**
- MAL is registered as a confidential "web" app; the client secret is sent in the token request body.
- The PKCE verifier is stored encrypted in an `oauth_states` row with a 10-minute expiry. An atomic UPDATE consumes that row, so each state works exactly once.
- A state cookie binds the callback to the browser that started the login.
- Sessions are 32 random bytes in an httpOnly, SameSite=Lax cookie, with only the SHA-256 hash stored. They last 30 days.
- POST routes also require `Origin` to match `WEB_ORIGIN`.
- Login failures redirect to `/?login_error=<code>` with a fixed set of codes.

**Alternatives:** A "public" MAL client with no secret; keeping the verifier in a signed or encrypted cookie; JWT sessions; an OAuth library.
**Why:** The backend can keep a secret, so a confidential client is stronger. Server-side state makes single use enforceable. Hashed opaque sessions can be revoked, and a database leak doesn't expose them. Libraries we checked assume S256, and MAL only supports `plain`.
**Consequences:** Logins need the database. Expired states and sessions are pruned at login time, with no background job. Refresh is serialized per user in-process, which is fine for one server process. Multiple instances would need a database lock.

## 2026-09-29 — Token encryption: AES-256-GCM bound to row context (Milestone 1)
**Decision:** Encrypt MAL tokens and PKCE verifiers with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` and a random 96-bit IV per value. Stored as `v1:<iv>:<tag>:<ciphertext>`. Authenticated data binds each value to its purpose and owner, e.g. `mal_refresh_token:<userId>`.
**Alternatives:** pgcrypto in the database; a KMS; libsodium secretbox.
**Why:** It uses only Node's built-in crypto, with no extra service or native dependency. GCM detects tampering. Binding the context means a ciphertext copied onto another user's row won't decrypt.
**Consequences:** Losing the key means everyone re-logs into MAL. An undecryptable token sets `needs_reauth` rather than crashing. The `v1` prefix allows key rotation later.

## 2026-09-29 — Integration tests: Testcontainers Postgres + fake MAL server (Milestone 1)
**Decision:** Integration tests start a real Postgres 18 (same digest as docker-compose) through Testcontainers, once per run. They drive the app with `app.inject` against a fake MAL, a real local HTTP server that enforces `plain` PKCE (the exchange only succeeds if the verifier equals the challenge). Tests also check that no issued secret ever appears in the logs.
**Alternatives:** A shared docker-compose test database; mocking `fetch`; testing against live MAL.
**Why:** Real Postgres catches SQL and migration bugs that mocks can't. A fake HTTP server exercises real request encoding. Live MAL can't run in CI and has undocumented rate limits.
**Consequences:** Integration tests need Docker, which CI's `ubuntu-latest` has. The fake must track MAL's real behavior; the manual live login at the end of the milestone is the check that it does.

## 2026-09-29 — List mirror: full fetch, then atomic replace (Milestone 1)
**Decision:**
- Each sync fetches the user's whole MAL anime list first: `limit=1000`, `nsfw=true`, following `paging.next` only while it stays on MAL's API host.
- It then upserts and deletes in one Postgres transaction, so the mirror exactly matches MAL.
- Anime metadata goes in a shared `anime` table; per-user progress goes in `list_entries`.
- MAL calls retry 429 and 5xx responses with capped, jittered backoff that honors `Retry-After`. A 401 triggers one refresh and one retry.
- Every attempt is recorded in `sync_runs` with a short error code.

**Alternatives:** Applying each page as it arrives; incremental sync by `updated_at` (MAL doesn't return deletions); per-user copies of anime metadata.
**Why:** Fetch-then-replace never leaves a half-applied list. A MAL outage mid-sync keeps the previous mirror instead of deleting entries that weren't fetched yet. Full syncs are cheap: most lists fit in one or two requests.
**Consequences:** Every sync re-reads the whole list, which is fine given the cooldown below. Lists above ~100k entries would hit the page cap. List statuses are a Postgres enum; media type and airing status stay as text, so a new MAL value can't break a sync.

## 2026-09-29 — Manual re-sync with a 60-second cooldown (Milestone 1)
**Decision:** Besides the sync on login, users can press Re-sync (`POST /sync`). Each user gets at most one sync per 60 seconds; anything sooner gets a 429 with `Retry-After`. A second request while a sync is running joins that run instead of starting another.
**Alternatives:** Login-only sync, as the hard rule "sync on login and after writes only" suggests; background polling.
**Why:** Milestone 1's Done-when criteria require that re-sync works, and M1 has no writes to trigger one. A cooldown keeps manual syncs from probing MAL's undocumented rate limits. There is still no polling.
**Consequences:** Edits made directly on myanimelist.net show up only after a login or a manual re-sync. Milestone 2 adds the post-write sync the hard rule describes.

## 2026-09-29 — Shared API contract package, enforced by server tests (Milestone 1)
**Decision:**
- `packages/shared` holds zod schemas and types for every server response the web app reads, plus shared constants (session cookie name, list statuses, login and sync error codes).
- The web app parses every API response with these schemas.
- The server's source doesn't import the package. Instead, contract tests parse real responses with it and use type-level checks to pin the error-code unions and constants.

**Alternatives:** The server imports the shared package directly (needs a build step or project references, because the package ships TypeScript source outside the server's `rootDir`); duplicating types in the web app; generating types from an OpenAPI spec.
**Why:** It catches contract drift in CI with zero build tooling. The package is TypeScript source that Next's Turbopack compiles directly and Vitest runs as-is.
**Consequences:** Server route types aren't checked against the contract at compile time, only in tests, so every new endpoint needs a contract test. If the server needs the package at runtime later, give it a build step.

## 2026-09-29 — List screen: server-rendered, tabs in the URL (Milestone 1)
**Decision:**
- The List screen is a Server Component. It fetches `/me` and `/list` from the API, forwarding only the session cookie.
- The selected status tab lives in the query string (`?status=`), and tabs are plain links.
- Re-sync and Log out are small client components that POST, then call `router.refresh()`.
- Cover art goes through `next/image`, allowlisted to `cdn.myanimelist.net`.

**Alternatives:** A client-rendered page with a data-fetching library; tab state held in React state.
**Why:** It needs almost no client JavaScript, tabs are linkable and survive reloads, and the session cookie never has to be readable by JS.
**Consequences:** Every tab switch is a server round trip, which is fine at list sizes of a few hundred. Revisit if the list needs client-side search or instant filtering.

## 2026-09-30 — Mirror MAL's alternative titles (Milestone 2)
**Decision:** List sync also fetches `alternative_titles` and stores them on `anime` as `title_en`, `title_ja` and a `synonyms` array. MAL's empty strings become null.
**Alternatives:** Matching on the main title only; asking the model to know every show's aliases.
**Why:** Nicknames and English names are how people refer to shows ("Apothecary Diaries" instead of "Kusuriya no Hitorigoto"). MAL already has them, and one extra field costs nothing during the full sync.
**Consequences:** The mirror needs one re-sync after migrating to fill them in. `search_my_list` and the eval snapshot both use them.

## 2026-09-30 — Eval cases: YAML against a frozen, sanitized list snapshot (Milestone 2)
**Decision:**
- Cases are YAML files in `apps/server/eval/cases/`, validated with zod. They're checked in CI by `pnpm eval:validate`.
- Each case names shows by any known title or by MAL id, and states the intended writes, whether the agent should ask, or that it should do nothing.
- Expected writes pass through the same normalization function as `propose_update` (`src/writes/normalize.ts`), so cases state intent rather than derived fields.
- The list is a committed, sanitized export of the developer's real list (`eval/snapshots/my-list.json`): ids, titles, alternative titles, media type, status, progress and episode counts. Scores, dates, tags, comments and the username are dropped.

**Alternatives:** JSON or TypeScript case files; expected tool-call transcripts instead of expected writes; a synthetic list; a local-only snapshot.
**Why:** YAML is the quickest format to hand-write 150 cases in. Judging on resulting writes rather than exact tool-call sequences lets prompts and tool usage evolve without rewriting cases. A real list tests the real nicknames, sequels and title collisions; sanitizing keeps personal data out of the repo, as CLAUDE.md requires.
**Consequences:** The snapshot is frozen once cases depend on it, and re-exporting would break relative cases. The public repo reveals which shows are on the list (titles and progress only), which the developer accepted. Normalization rules are shared, so changing a rule changes eval expectations too, deliberately.

## 2026-09-30 — One model provider interface; Gemini via SDK, Ollama via REST (Milestone 2)
**Decision:**
- Every model call goes through `ModelClient` in `apps/server/src/llm/`. It routes a `provider:model` ref to a `ModelProvider`, and each provider reports tool calls, text, token usage and latency in one shape.
- Gemini uses the official `@google/genai` SDK. Ollama uses plain `fetch` to `/api/chat`.
- A lint rule plus an architecture test forbid importing any model SDK outside `src/llm/providers/`.
- Providers never retry on their own. They classify failures (`rate_limited`, `unavailable`, `auth`, `bad_request`, `bad_response`) so the caller decides.

**Alternatives:** Raw REST for Gemini too; an abstraction library (e.g. LangChain, Vercel AI SDK); the Ollama npm client.
**Why:** Gemini 3 function calling needs thought signatures replayed exactly, which the SDK handles; we keep the model's raw turn as opaque `providerState`. Ollama's API is small and stable, so an SDK buys nothing. One narrow interface keeps swaps a config change, as CLAUDE.md requires.
**Consequences:** A new provider is one file under `providers/`. The SDK's automatic retries are off (`attempts: 1`), so 429s reach the routing logic.

## 2026-09-30 — Model roles and prices live in config/models.json (Milestone 2)
**Decision:**
- `apps/server/config/models.json` maps roles to models: `agent` → `gemini:gemini-3.5-flash-lite`, `escalation` → `gemini:gemini-3.8-flash`, `eval` → a local Ollama model. Roles can be overridden per environment (`AGENT_MODEL`, `AGENT_ESCALATION_MODEL`, `EVAL_MODEL`).
- The same file holds paid-tier prices per 1M tokens, for cost-per-update reporting, and Ollama options.
- Ollama's context is capped at 8,192 tokens (`numCtx`).

**Alternatives:** Hard-coded defaults in `config.ts`; environment variables only.
**Why:** CLAUDE.md says model IDs live in config, not code, and swapping a model must be a config change. The IDs are the current ones from Google's model and pricing pages (2026-09-30). The context cap is necessary: `qwen3.6:27b`'s 256K default made Ollama crash on the 16 GB RTX 5080, while 8K ran fine (69% GPU / 31% CPU).
**Consequences:** Prices go stale; Flash rises on 2027-01-01, noted in the file. The eval model is `ornith:9b` until the benchmark on the example cases picks between it and `qwen3.6:27b`.

## 2026-09-30 — The write path: proposals, a locked commit state machine, undo through the same path (Milestone 2)
**Decision:**
- `proposeUpdate` resolves relative progress into absolute values, applies the normalization rules, and stores prior values plus only the changed fields.
- Each proposal has an idempotency key of run + anime + resulting values, so a repeated tool call yields the same proposal.
- `commitProposal`, in `writes/commit.ts`, is the only code that reaches MAL. It locks the proposal row and moves it `pending → committing → committed`. A retried or concurrent commit returns the stored result without a second PATCH.
- A commit is refused as `stale` if the mirror moved since the proposal was made.
- After a write, the mirror takes MAL's own response, and a change-log row records the before and after values.
- Undo proposes the prior values and commits them through the same function. It's refused if the entry has changed since.
- Proposals that need confirmation (unclear match, or progress going backwards) wait for the user.
- Lint and an architecture test allow only `commit.ts` to import the write client.

**Alternatives:** Letting the model pass write arguments; storing deltas; last-write-wins without a staleness check; undo via a separate MAL call.
**Why:** These make CLAUDE.md's write rules structural rather than prompt-dependent: a single write path, idempotency, no double-counting, and a change log with prior values. The locked state machine was verified by sabotage: removing the row lock makes the concurrent-commit test fail.
**Consequences:** One extra database round trip per commit. A proposal made before a re-sync that touched the same entry must be re-proposed, which is correct but surfaces as a "stale" failure the agent has to handle.

## 2026-09-30 — Title search: pg_trgm over all names, with a clear-match rule (Milestone 2)
**Decision:**
- `search_my_list` scores every name of every show on the user's list (title, English, Japanese, synonyms) against every query variant. The score is the greater of `pg_trgm`'s `similarity` and `word_similarity`, and the best one is kept.
- A candidate is a clear match if it scores at least 0.6 and beats every rival by 0.15, or if it's the only in-progress show (watching or on hold) among near-tied matches. That second case covers sequel seasons ("frieren ep 5" with season 1 completed and season 2 watching).
- No trigram indexes: one user's list is a few hundred rows.

**Alternatives:** Exact and substring matching only; embeddings; asking the model to pick without scores.
**Why:** Trigrams handle typos and partial titles in-database with no new dependency. An explicit, testable clear-match rule decides which writes may commit without asking, instead of trusting the model's confidence.
**Consequences:** The thresholds are guesses until the eval runs, so tune them against clarification precision and wrong-write rate. Abbreviations MAL doesn't list as synonyms ("JJK") depend on the model expanding them.

## 2026-09-30 — Agent loop: grounding enforced in the tools, outcomes from what happened (Milestone 2)
**Decision:**
- The agent is a bounded tool loop: at most 6 model turns, with the last 6 chat messages as context.
- The tools enforce the rules:
  - `propose_update` accepts only anime ids that `search_my_list` or `get_entry` returned in the same run.
  - It passes "clear match" only for ids a search marked clear, which decides whether the proposal waits for confirmation.
  - `commit_update` accepts only proposals created in the same run.
- Tool arguments are validated with zod and errors go back to the model, so it can correct itself.
- A run's outcome comes from what actually happened: committed, needs_confirmation (a proposal waiting for the user), clarification (the reply asks something), no_action, or error.
- Every run and every step is logged to `agent_runs` / `agent_run_steps`: prompt version, model, tool calls with arguments, latency, tokens and outcome.
- Prompt v1 (`progress-sync@1`) spells out the mapping from phrases to fields and tells the model to ask instead of guessing on unclear matches.

**Alternatives:** Trusting the prompt for grounding; a single-shot parse into a JSON plan with no tools; asking the model to self-report its outcome.
**Why:** Sabotage checks showed the tests fail if either grounding rule is removed, so wrong writes don't depend on the model obeying the prompt. Deriving outcomes from events keeps the eval's clarification metric honest.
**Consequences:** "Asked a question" is detected by a question mark in the reply. That's crude, so the prompt forbids trailing pleasantries, and the eval's clarification precision will show whether it holds.

## 2026-09-30 — Chat routing and API (Milestone 2)
**Decision:**
- Each message runs on the agent model, Flash-Lite. If that run wrote nothing and ended asking, holding a change, or failing (not for a missing API key), it's retried once on the escalation model, Flash.
- The escalated answer replaces the first only if it succeeds, and the first run's held proposals are then cancelled. Both runs are logged, linked by `escalated_from_run_id`.
- Endpoints:
  - `POST /chat/messages`: 10 per minute per user, one at a time.
  - `GET /chat`, `GET /changes`
  - `POST /proposals/:id/confirm` and `/cancel`
  - `POST /changes/:id/undo`
- Every response is in the shared contract.

**Alternatives:** Classifying messages up front to pick a model; always using Flash; no escalation.
**Why:** Flash's free quota is small, about 20 a day, so it's spent only where Flash-Lite couldn't finish, as the design intends ("Flash for ambiguous requests"). Rate limits keep a chatty session inside the free tier.
**Consequences:** An escalated message costs two runs of latency. The in-memory rate limiter and busy flag assume a single server process.

## 2026-09-30 — Eval harness: the real agent on a real Postgres, a fake MAL writer, judged on writes (Milestone 2)
**Decision:**
- `pnpm eval` starts a throwaway Postgres (Testcontainers) with the real migrations.
- For each case it loads the snapshot as a fresh list, then runs the production `runAgent` with the production prompt, tools, search and commit path. The only fake is the `ListWriter`, which records writes instead of sending PATCHes.
- It scores the committed changes against the case's normalized expectations, and counts "asked" when the agent held a proposal or its reply asks a question.
- It reports update accuracy, wrong-write rate, clarification precision and recall, median and p90 latency (after a warm-up call), and cost per update. The cost is also shown at the agent model's paid prices, because local models cost $0.
- It breaks results down by tag, explains each failure with the tool calls, and writes a JSON report.

**Alternatives:** Mocked tools; scoring the model's tool calls instead of the writes; an in-memory database.
**Why:** Everything except the MAL network call is the code users run, so the eval measures the system rather than the prompt alone: grounding, the clear-match rule, normalization and the commit path included.
**Consequences:** Each run needs Docker and Ollama, so it isn't part of CI. `eval:validate` is. Each case costs one snapshot reload (a few hundred rows), which is negligible next to model latency.

## 2026-09-30 — Eval model: ornith:9b over qwen3.6:27b, for now (Milestone 2)
**Decision:** `config/models.json` keeps `ornith:9b` as the eval model.
**Alternatives:** `qwen3.6:27b`.
**Why:** On the 5 example cases with prompt v1, `ornith:9b` scored 4/5 with no wrong writes, median 1.35 s. `qwen3.6:27b` scored 3/5 with no wrong writes, median 3.96 s. It once replied without searching at all ("Fixture isn't a recognized anime title"). The 27B model also runs partly on CPU on the 16 GB GPU.
**Consequences:** Five synthetic cases are thin evidence. Re-run both models on the real ~150 cases before settling. Both failed the multi-show and sequel example, and both asked unneeded questions (clarification precision 33%), which is prompt work once the real cases exist.

## 2026-09-30 — Never show a reply that claims an unwritten change (Milestone 2)
**Decision:** If a run committed nothing, held nothing and didn't ask, but its reply claims a change (a broad pattern: "updated", "marked", "now at", "set … to", …), the chat service shows "I didn't change anything on your list…" instead. The model's own text stays in `agent_run_steps`. Eval cases can now carry `history` (earlier turns), so the behavior is measurable.
**Alternatives:** Prompt v2 alone, with explicit rules that history is context only and that nothing may be called updated unless `commit_update` returned "committed". Also: forcing a tool call on every turn, and dropping assistant turns from the history.
**Why:** End-to-end testing found that `ornith:9b`, given an earlier "Updated …" reply in the history, replies "Updated …" with no tool calls. The safety design held, since nothing was written, but the text was false. Prompt v2 did not fix it on the examples: the history case still failed. It also regressed, scoring 2/5 against v1's 3/5, with one wrong write. So v2 wasn't adopted. A structural check can't be talked out of the rule.
**Consequences:** False positives only cost an unneeded "nothing changed" note. The underlying model behavior remains and shows up as failed history cases in the eval, so it's something to fix with prompt work once the real cases exist.

## 2026-09-30 — The in-progress tie-break applies only to forward progress (Milestone 2)
**Decision:** This refines "Title search: pg_trgm over all names, with a clear-match rule". Search results now say why a match is clear: `unique` (ahead by a margin) or `only_in_progress` (the one show being watched among near-ties). A unique match is clear for any change. An `only_in_progress` match is clear only for forward progress (episodes, or setting watching or completed). Dropping, pausing, scoring or rewatching needs a unique match, or it's held for confirmation.
**Alternatives:** Keeping the tie-break for all changes; removing it entirely.
**Why:** With the tie-break applying to everything, "dropping the isekai one" dropped the only isekai show in progress without asking. That was a wrong write in the eval, and it contradicts the design doc: "ambiguous ones ('the isekai one' matching three shows) ask first". Removing the tie-break would make "finished frieren" (season 1 completed, season 2 watching) ask every time.
**Consequences:** Status and score changes on vague references now surface as Confirm cards. The user's eval cases will show whether the boundary is right.

## 2026-10-01 — The agent sees MAL's airing status; unaired shows aren't "in progress" (Milestone 2)
**Decision:**
- Search and `get_entry` now return MAL's airing status. The mirror has stored it since Milestone 1, but the agent couldn't see it.
- The in-progress tie-break skips shows MAL says haven't aired.
- `propose_update` holds progress on an unaired show (more episodes, or completing it) for confirmation, with reason `not_yet_aired`. Status changes like dropping it go through.
- Eval snapshots carry `airingStatus`. Older snapshots load with it unknown, and `eval:validate` warns about cases that expect a write the agent will hold.
- The prompt is unchanged: the server enforces the rules, and the field explains itself.

**Alternatives:**
- Asking the user to move upcoming shows to Plan to Watch.
- Refusing progress on unaired shows outright.
- Prompt v3 telling the model about airing status.

**Why:** The user keeps upcoming sequels in Watching, so the brief will cover them when they premiere (Milestone 3). Without the airing status, "black clover ep 3" picked the unaired season 2 as the season in progress. The mirror's airing status is only as fresh as the last sync, so a just-premiered show could still read "not yet aired"; that calls for confirming, not refusing. A prompt change can't be measured until the real eval cases exist, so it waits.
**Consequences:**
- A franchise whose only "watching" entry hasn't aired now gets a question instead of a guess.
- The eval snapshot must be re-exported to carry airing status for the user's real list. That has to happen before the cases are written.

## 2026-10-02 — Shorthand eval cases are read directly, not converted to YAML (Milestone 2)
**Decision:** `.txt` files in `eval/cases/` are a second case format. Each line holds one case: `<message> => <writes | ask | none> #tags // note`, optionally preceded by `user:`/`bot:` lines for earlier turns. `loadCases` parses them into the same case schema as YAML, so validation, the runner and reports treat both the same. Errors point at the line. Ids come from the file name and the message. `pnpm eval:lookup` searches a snapshot by name, list status or airing status, and prints the exact name to use in a case.
**Alternatives:** an `eval:import` command that converts shorthand into YAML files; YAML only.
**Why:** The user wants to write cases fast, and a converter would leave two copies of every case that could drift apart. Reading shorthand directly means no extra step to forget. The labels are still entirely the user's: the parser only transcribes them.
**Consequences:** Ids change if a message is edited, so comparing a case across runs works best once its wording is settled. Titles containing ":" work, because the last ":" separates the title from the fields. Tags are only read at the end of a line, so titles containing "#" also work.
