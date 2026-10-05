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

## 2026-10-02 — "Started X" means episode 1 watched (Milestone 2)
**Decision:** The user decided that "started X" means they've watched episode 1, so eval cases label it as `episodes_watched: 1`. On a Plan to Watch or On Hold show, the normal rules then also set Watching. The eval README now has a section of wording conventions like this one, so every case uses the same meaning.
**Alternatives:** "Started" meaning only "moved to Watching" with no episode, which does nothing for a show already in Watching. Asking every time.
**Why:** The user's call. The user often keeps shows in Watching at episode 0 before starting them, so a status-only meaning would make "started" do nothing for those. Prompt v1 already maps "started" to episode 1, so no prompt change is needed.
**Consequences:** "Started" on a show past episode 1, or a completed one, counts as backwards progress and is held for confirmation. Whether "started" on a dropped show should also move it back to Watching is still open; the user's cases will show it.

## 2026-10-03 — Search: exact names, one verdict per query, season numbers, franchise-only tie-break (Milestone 2)
**Decision:** This refines "The in-progress tie-break applies only to forward progress".
- **Exact names win.** A name that is exactly the query (ignoring case and punctuation) scores 1. Any other name is capped at 0.95, so "Another" no longer ties with "…in Another World". There's one exception: if other entries' names *start with* the query ("Bungou Stray Dogs 4th Season"), the exact match isn't decisive and the season rules decide.
- **Each query is judged on its own.** One search can carry title variants or several shows ("World Trigger", "One Piece") without them competing. An entry is clear if any query makes it clear. The rule looks at the top 20 matches, not only the 5 the model sees.
- **Season and part numbers count.** "Season 2", "2nd season", "IV", "s2", "Part 2", "Cour 2" and a trailing "3" narrow the candidates to that season. If a franchise numbers its seasons and the named one isn't on the list, nothing is clear. Franchises that name seasons after arcs ignore the number.
- **The in-progress tie-break needs one franchise,** meaning every tied entry has a name starting with the same words. Shows that only share a word ("blue": Blue Lock and Grand Blue, "the isekai one") stay unclear, as the design doc asks.

**Alternatives:** Keep one combined ranking with the word-containment score; make the model search one show per call; infer missing season numbers from MAL's id order.
**Why:** The first real eval (50 cases) showed the server holding clear requests as ambiguous. "I am starting Another", "started World Trigger and dropped one piece", the full "Mushoku Tensei III: …" title and "One Punch Man 3" all tied with other entries. Inferring missing numbers from id order breaks on franchises split into parts (Attack on Titan, Mushoku Tensei).
**Consequences:**
- A named season that MAL calls by an arc name (Seven Deadly Sins "season 3") isn't found by number. It fails safe (nothing clear, so the agent asks), and a query without the number still finds the season in progress.
- An unrelated show whose name starts with another show's full name would block the exact-name rule for it. On the user's list that hasn't happened.

## 2026-10-03 — A held change counts from the moment it's proposed; runs that did work never end in an error (Milestone 2)
**Decision:**
- A proposal that needs confirmation joins the run's pending list as soon as `propose_update` creates it, not only after the model calls `commit_update` on it. That's what Chat already shows (a Confirm card), and the eval, the run outcome and escalation now agree with it.
- A model that calls `commit_update` twice on the same held proposal is stopped there.
- A run that wrote or held something but ran out of turns ends with a plain reply ("Done." / "That change needs your confirmation.") instead of an error, and `agent_runs.error` keeps the reason (`max_turns`, `repeated_commit`).
- `propose_update` results say what to do next: commit it, or tell the user it needs confirmation.

**Alternatives:** Count holds only through `commit_update` (the old behavior); raise the turn limit; auto-commit clear proposals the model forgot to commit.
**Why:** In the first real eval, two runs looped on `commit_update` for a held change until they hit the turn limit, so Chat would have said "I got stuck" even though a Confirm card was ready. The harness also undercounted asking. Auto-committing would make the server, not the model, decide to write, which goes beyond "commit_update is the only way to write".
**Consequences:** On the batch-1 cases (ornith:9b, prompt v1), these two decisions together took update accuracy from 52% to 68%, the wrong-write rate from 25% to 12.5%, and errors from 2 to 0. The rest is model behavior: claiming writes it didn't make, unneeded follow-up questions, and nickname mistakes. That's prompt work.

## 2026-10-03 — Prompt v3 becomes the app's prompt (Milestone 2)
**Decision:** `progress-sync@3` replaces `@1` as the prompt the app uses. Compared with v1 it adds:
- the user's wording conventions: "started" / "picked up" = episode 1; "watched N episodes" = N more; "next episode" / "continued" = one more; a one-episode show watched = 1; no episode given, a vague amount or "the newest episode" → ask
- nothing has changed until `commit_update` returns "committed"
- commit clear changes without asking permission (the user can undo)
- keep season numbers and full titles in searches, and search once more before saying a show isn't on the list
- when a change is refused, say why without retrying a guess

The name skips 2 because v2 was an eval-only experiment (see "Never show a reply that claims an unwritten change").
**Alternatives:** Keep v1; tune further before switching.
**Why:** On batch 1 (50 cases, ornith:9b, with the search fixes):
- update accuracy went from 68% to 82%
- the wrong-write rate went from 12.5% to 8.7%
- plain, relative and sequel cases went from 56 / 50 / 57% to 89 / 83 / 86%

The 5 synthetic examples went from 3/5 to 2/5. Their made-up titles confuse the model, so that's noise next to 50 real cases.
**Consequences:** v3 now encodes conventions the user decided while labeling batch 1, so batch 1 no longer tests v3 without bias. The next batch is the real check. Still open:
- the model's own guess can override an ambiguous name ("blue" → it searched "Blue Lock")
- arithmetic on "watched N episodes"
- repeated identical searches
- nickname mistakes ("bsd", "sds")
- multi-show messages that write only some of the clear shows

## 2026-10-03 — A model's guessed title can't settle what the user's words left open (Milestone 2)
**Decision:**
- Search now receives the user's message. A query that appears in it is treated as the user's own words; any other query is a title the model supplied.
- When the user's words strongly match different shows ("blue": Blue Lock and Grand Blue), a model-supplied title ("Blue Lock") can't make one of those shows clear. The set of such shows lasts for the whole run, so a later search can't settle it either.
- Model-supplied titles still decode nicknames that match nothing literally ("omp 3").
- The same search run a third time ends the run with "I couldn't work out which show you mean…" instead of using up every turn.

**Alternatives:** Ignore model-supplied titles entirely (nicknames would break); require the user's words to come first in the queries (relies on the model).
**Why:** The batch-1 eval wrote "Blue Lock Season 2: ep 1" for "Just watched episode one of blue", which the user labeled as a question. Another run spent all six turns searching for a show that isn't on the list.
**Consequences:**
- If the model leaves the user's words out and decodes a nickname wrongly ("sds" → Sword Art Online), search can't tell. That's model knowledge.
- On batch 1 (ornith:9b, v3): ambiguous cases 10/10, no errors, accuracy 80% (82% before, within run-to-run noise), and the "blue" wrong write is gone.

## 2026-10-03 — Eval runs on Gemini are throttled (Milestone 2)
**Decision:** `pnpm eval --rpm N` spaces model calls to at most N a minute, and Gemini defaults to 10. When the provider still says "rate limited", the harness waits (20, 40, 60 s) and retries instead of failing the case. Waiting is left out of the reported latency.
**Alternatives:** Running Gemini evals unthrottled and accepting failed cases; a paid tier.
**Why:** The pass level is judged on Flash-Lite, the model the app uses, on its free tier, which limits calls per minute. One run of 50 cases is about 175 calls, roughly 20 minutes.
**Consequences:** A Flash-Lite run uses part of the free tier's daily requests, which Chat shares.

## 2026-10-03 — A tie stays a tie; arc-named seasons; "the newest episode" is held (Milestone 2)
**Decision:** This refines "A model's guessed title can't settle what the user's words left open".
- **A tie stays a tie.** When any search query in a run leaves entries tied, only a query made of the user's own words can make one of them clear. A title the model supplied can't, even an entry's exact name. This replaces the narrower rule that only covered ties between different franchises found by the user's words.
- **Arc-named seasons.** If the user names season N, no entry is numbered N, and season N−1 is numbered, then season N is the one TV entry without a season number that is newer (higher MAL id) than every lower-numbered season. If none or several fit, or that season comes in parts, nothing is inferred.
- **"The newest episode" is held.** If the message means the newest episode without giving a number ("the newest ep", "the ep that dropped", "caught up on X"), progress is held for confirmation with reason `newest_episode_unknown`. Chat explains "I can't look up the newest episode yet". `eval:validate` warns about cases that expect such a write.

**Alternatives:** Prompt-only instructions; inferring every unnumbered season by MAL id order; refusing "newest episode" progress outright.
**Why:** On the first Flash-Lite run there were 5 wrong writes:
- 2 were Tower of God's two "Season 2" entries, resolved by a title the model named.
- 2 were "the newest episode" read as one more.
- 1 was "season 3" of Seven Deadly Sins, which MAL calls "Imperial Wrath of the Gods" and search couldn't find.

The prompt already said to ask about the newest episode, and Flash-Lite ignored it. Holding instead of refusing keeps the right answer one tap away, until Milestone 3 brings airing schedules that can tell which episode is newest.
**Consequences:**
- Asking goes up wherever the model, not the user, would have picked between tied entries.
- An inferred season is "unique" (clear for any change). The N−1 rule and the parts check keep it to cases like Seven Deadly Sins and Jujutsu Kaisen's Culling Game.
- On the real list:
  - Seven Deadly Sins "season 3" now finds Imperial Wrath.
  - Attack on Titan "season 4" and both Tower of God cases stay unclear.
  - DanMachi "4th season" still resolves from the user's words.

## 2026-10-03 — Rewatching only applies to a completed show; "just watched X" means the next episode (Milestone 2)
**Decision:**
- `normalizeChange` refuses `is_rewatching: true` unless the show ends up completed (error `rewatch_not_completed`). The tool tells the model that starting an unfinished show again means episode 1.
- The user decided that "just watched X" with no number means the next episode. The batch-1 case "just watched daemons" changed from `ask` to episode 18, and the eval README records the convention.
- The user also confirmed the strict wrong-write metric: a write to the right show with the wrong values counts as a wrong write.

**Alternatives:** Leave rewatch handling to the prompt; report "wrong show" and "wrong values" separately.
**Why:** On Flash-Lite, "Im going to start Seven Deadly Season 3 again" (an on-hold show) was written as a rewatch. MAL keeps a show completed while it's rewatched, so a rewatch of an unfinished show is always a misreading.
**Consequences:** A user who really means to restart an unfinished show from the beginning gets episode 1, which is the same thing on MAL.

## 2026-10-03 — Prompt v4 becomes the app's prompt (Milestone 2)
**Decision:** `progress-sync@4` replaces `@3`. It says that "started" / "picked up" / "starting X again" set episode 1 rather than only the status, that "again" on an unfinished show isn't a rewatch, and that "just watched X" with no number means the next episode (the user's decision).
**Alternatives:** Keep v3.
**Why:** Batch 1 on Flash-Lite (the app's model), with the rewatch rule:

| | v3 | v4 |
| --- | --- | --- |
| update accuracy | 88% | **98%** (49/50) |
| wrong writes | 4/30 | **0/31** |
| clarification precision | 80% | 88.9% |
| clarification recall | 94% | 100% |
| median latency | 2.4 s | 2.3 s |

On the local eval model (ornith:9b) v4 roughly matches v3: 80% accuracy, 3 wrong writes against 2, and one error.

**Consequences:**
- Against the agreed pass level (95% accuracy, under 1% wrong writes, 90% clarification precision, judged on Flash-Lite), batch 1 now passes accuracy and wrong writes. Precision is one question short: the two extra asks are a held Mushoku Tensei drop and "did you mean Chainsaw Man?" for a show not on the list.
- Batch 1 has been tuned against repeatedly, so these numbers are optimistic. A fresh batch is the honest check.
- The local model trails Flash-Lite by about 18 points, so local runs show direction, not pass or fail.

## 2026-10-03 — A varied eval snapshot instead of a test MAL account (Milestone 2)
**Decision:** Add `eval/snapshots/varied-list.json`: the user's sanitized list with 14 entries' status or progress changed by hand to cover states the real list lacks. Those states are shows mid-season, on hold and dropped part-way, rewatches in progress, a movie still to watch, and a season or part in progress. Batch 2 can use it with `snapshot: varied-list`. Batch 1 stays on `my-list`.
**Alternatives:**
- A second MAL account. It would need the user to sign up and build its list by hand, and creating accounts isn't something the assistant can do.
- A fully synthetic list. Made-up titles can't test nicknames or real sequel naming.
- Changing the user's real MAL list.

**Why:** The user's real list has only 3 shows with episode progress, no rewatches, nothing on hold or dropped part-way, and no unwatched movies. Keeping the real titles keeps nickname and sequel cases realistic.
**Consequences:** Cases on `varied-list` test behavior in states the user's list doesn't actually have, which is fine for an eval. The file is frozen and never re-exported. Its description and the eval README list exactly what changed.

## 2026-10-04 — Batch 2 fixes: sequel titles only, rewatches in progress, answers settle ties (Milestone 2)
**Decision:**
- **Sequel titles only.** When an exact name is checked for later seasons that start with it, only an entry's main or English title counts. Other shows' alternative names don't ("Monster #8" is Kaiju No. 8, not a season of Monster).
- **Rewatches count.** A show being rewatched counts as "in progress" for the season tie-break.
- **Answers settle ties.** When the user's message answers the agent's own question (the last turn was the agent's and asked something), naming an entry exactly settles a tie with its later seasons ("clannad" after "Clannad or After Story?").
- **Prompt v5:**
  - plans and maybes ("thinking about starting X") aren't updates
  - an entry named for what the user said ("the final season", "the movie") is used as is, not mapped to a season number
  - the agent only asks when a change needs the answer, with no offers or follow-up questions
- **Relabel.** The batch-2 case "Lets put The Apothecary Diaries back into the rotation" was relabeled from Plan to Watch to no write: the show is already Watching, and the user agreed the wording means that.

**Alternatives:** Treat batch 2's misses as model noise and keep tuning prompts only.
**Why:** On batch 2's untouched run (Flash-Lite, v4: 82.5%, 2 wrong writes of 30, clarification precision 38%), most misses had general causes:
- an alternative-name collision ("Monster", 2 cases)
- rewatches not counting as in progress (Code Geass)
- an answer to "which one?" still tying (Clannad)
- a convention v4 didn't have yet (thinking about starting)
- "final season" mapped to season 7
- offer-style questions

**Consequences:** Batch 2 is now tuned on too, like batch 1. The next unbiased check is real use or a new batch. "Answering" is inferred from the previous turn ending in a question, so a user answering some unrelated question by naming a franchise's first season exactly would get that season.

## 2026-10-05 — Prompt v5 becomes the app's prompt (Milestone 2)
**Decision:** `progress-sync@5`, together with the batch-2 search fixes above, replaces `@4` as the app's prompt.
**Alternatives:** Keep v4.
**Why:** On Flash-Lite:

| | batch 2, v4 (untouched) | **batch 2, v5** | batch 1, v4 | **batch 1, v5** |
| --- | --- | --- | --- | --- |
| accuracy | 82.5% | **97.5%** | 98% | **96%** |
| wrong writes | 2/30 | **1/34** | 0/31 | **0/31** |
| clarification precision | 38% | **83%** | 89% | **83%** |
| clarification recall | 100% | **100%** | 100% | 94% |

Batch 1 is within a case of v4. Its new misses are "bleach episode 380", which explained the refusal without asking, and the Mushoku Tensei follow-up, which is still held.
**Consequences:**
- The remaining wrong write is "Your name was sooooo good" → score 10. When v3 was written, v1's "never invent episode numbers or scores" line was dropped. Restoring it, plus a code guard, is the next step.
- Clarification precision (83%) is still under the 90% target. The extra asks are mostly held changes and trailing questions.

## 2026-10-05 — Scores need a number in the user's message; prompt v6 (Milestone 2)
**Decision:**
- If the user's message has no number in it (digits or a number word), a score in the proposed change is held for confirmation (reason `score_not_given`). Chat explains it, and `eval:validate` warns about cases expecting such a write.
- Prompt v6 restores v1's "never invent an episode number or a score", which was dropped when v3 was written, and adds "liking a show isn't a score".
- v6 is registered, but v5 stays the app's prompt until v6 is confirmed on batch 1 with Flash-Lite. Today's free quota only covered batch 2.

**Alternatives:** Prompt only; refusing such scores outright.
**Why:** Batch 2 on v5 turned "Your name was sooooo good" into a score of 10. A structural check catches invented scores whatever the model does, and holding them keeps a real "I'd give it a perfect score" one tap away.
**Consequences:**
- Batch 2 on v6 (Flash-Lite): 97.5%, and the invented score is gone.
- One wrong write remains, and it varies between runs. "Im rating the final mha season a 10" went to Season 7 after the model added its own "mha season 7" search. It passed on v5.
- Batch 1 on v6 locally: 82% (v5: 80%).

## 2026-10-05 — The model's guesses can't decide between seasons (Milestone 2)
**Decision:** This refines "A tie stays a tie". Four rules, all about telling the model's guesses apart from the user's words:
- **Conflicting guesses.** If titles the model supplied (not the user's words) point at two different seasons of one show, both are contested, and the agent asks. "One show" here means one entry's main or English title starts the other's, or their titles share at least their first two words. Shows that only share a first word ("Tokyo Ghoul", "Tokyo Revengers") don't count.
- **Which ties count.** A tie only contests its entries when it's in the user's own words, or between seasons of one show. A vague model title that happens to fit different shows ("mha final season" also fits Attack on Titan's Final Season) no longer blocks a precise one.
- **Searches of guesses only.** A search containing none of the user's words is all guesses. There, only an entry's exact name makes it clear: no fuzzy matches and no season tie-break. Nicknames still decode through exact names ("omp 3" → "One Punch Man 3").
- **Later seasons.** An entry counts as a later season of an exact match if one of its names starts with the query and its title shows it's the same show. This refines the earlier titles-only check, which had stopped seasons that share an alternative name ("DanMachi", "DanMachi II") from counting.

**Alternatives:** Prompt-only fixes; trusting the model's exact titles whenever they're unique.
**Why:** Batch 2 on v6 wrote "Im rating the final mha season a 10" to Season 7. The model's vague "mha final season" tied My Hero Academia's Final Season with other shows, which blocked the precise title. Its own "mha season 7" guess was then the only clear match. Locally, "Just watched episode one of blue" was written to Blue Lock Season 2 after the model searched only its guess "Blue Lock".
**Consequences:**
- When the model guesses between seasons, the agent asks instead of writing. That trades a possible wrong write for a question.
- On the real list, "final mha season" resolves to Final Season unless the model also guesses "season 7" (then it asks). DanMachi "4th season" still resolves, and "blue" asks however the model searches.
- Local runs: batch 1 unchanged at 82%; batch 2 70% (its first local run).
- The Flash-Lite check waits for the free quota to reset.

## 2026-10-05 — Gemini moves to the paid tier (Milestone 2)
**Decision:** The Gemini API key's project is on the paid tier, with $5 of prepaid credit. Gemini evals now default to 60 calls a minute (`--rpm`).
**Alternatives:** Staying on the free tier and spreading eval runs across days; running every eval locally.
**Why:**
- The free tier's daily quota (shared with Chat) covered about one batch of cases a day, so each fix waited a day for its Flash-Lite check.
- A 90-case Flash-Lite run costs about $0.20 on the paid tier.
- The paid tier doesn't use prompts to improve Google's products. That covers the design's rule that a paid tier comes before other users' data does, and CLAUDE.md's reminder to leave the free tier before Milestone 5.

**Consequences:**
- Eval runs and Chat cost real money, a few cents a day at the current volume.
- A full run takes about 5 minutes instead of an afternoon.
- The model IDs are unchanged.

## 2026-10-05 — Prompt v6 becomes the app's prompt; Milestone 2 eval results (Milestone 2)
**Decision:** Prompt v6 replaces v5 as the app's prompt.
**Alternatives:** Keeping v5, which scored the same on batch 2 but can invent scores.
**Why:** v6 held up on both batches with Flash-Lite after the conflicting-guesses fix. It doesn't invent scores, and it made no wrong writes.
**Consequences:** Flash-Lite results for v6 on all 90 cases (batch 1 on my-list, batch 2 on varied-list):

| Metric | Result | Target |
|---|---|---|
| Update accuracy | 97.8% (88/90) | ≥95% |
| Wrong-write rate | 0% (0/63) | <1% |
| Clarification precision (recall) | 84% (100%) | ≥90% |
| Median latency | 2.4 s | |

- The two misses wrote nothing. Batch 1's Mushoku Tensei follow-up was held instead of written. Batch 2's "final mha season" asked "Season 7 or the Final Season?" because the model guessed both.
- Precision is 21 of 25 asks. The four unneeded asks are the two misses, a DanMachi change held alongside the right one, and a recommendation reply that ended in a question. Removing any two of them would reach 90%.
