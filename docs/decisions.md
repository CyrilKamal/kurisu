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

## 2026-10-05 — Milestone 2 is done, with clarification precision below target (Milestone 2)
**Decision:** Milestone 2 counts as done at 97.8% accuracy, no wrong writes, and 84% clarification precision. The precision target was 90%.
**Alternatives:** A fix round for the Mushoku Tensei follow-up and the extra DanMachi hold, which would have reached about 91%.
**Why:**
- Every miss was a question the agent didn't need to ask, never a wrong write. When in doubt, the agent should ask rather than write.
- Tuning further on the same 90 cases would mostly fit to them.

**Consequences:**
- The extra questions stay for now. The friends beta (Milestone 5) will show whether they annoy anyone.
- Any change that trades a question for a guess has to keep the wrong-write rate at zero.

## 2026-10-05 — AniList client and a shared airing cache (Milestone 3)
**Decision:**
- A small AniList GraphQL client (`fetch` plus zod) makes two queries:
  - Shows by MAL id: AniList id, status, episode count, next episode, and enabled streaming links.
  - Episodes that aired in a time window.
- It spaces requests 3 seconds apart, asks for 50 ids per request, and retries 429 and 5xx responses (honoring `Retry-After`).
- Results go in an `anilist_media` table keyed by MAL id and shared by all users. A row younger than 6 hours isn't refetched.
- A MAL id with no AniList match is logged with its title and stored without an AniList id, so it's skipped until the next refresh.
- The latest aired episode is worked out from the cached next episode and its air time, and is unknown when:
  - the row is more than 7 days old,
  - the cached next episode aired more than 6 days ago (another may have aired since), or
  - an airing show has no scheduled next episode.
- A new architecture test allows network calls only from the API client modules.

**Alternatives:** An AniList client library; fetching live on every brief and chat message; storing AniList ids on the `anime` table.
**Why:**
- AniList currently allows 30 requests a minute (normally 90). A cache shared by every user keeps briefs and chat well under that.
- Chat can read the latest aired episode without waiting on AniList.
- Two queries don't justify a GraphQL library.

**Consequences:**
- Airing data can be up to 6 hours old. Episode air times rarely move that fast, and the next-episode time still says when a new one has aired.
- AniList's airing time is the Japanese broadcast time, so a streaming service may post an episode a bit later than the brief says.

## 2026-10-05 — Web push: web-push for encryption, our own send, known push services only (Milestone 3)
**Decision:**
- The `web-push` library encrypts and signs each message (VAPID, aes128gcm) through `generateRequestDetails`. We send the request ourselves with `fetch`.
- The server only sends to the browsers' push services:
  - FCM (Chrome and Android)
  - Mozilla
  - Apple (`web.push.apple.com`, `*.push.apple.com`)
  - Windows (`*.notify.windows.com`)

  It only stores subscriptions that point at them, and checks again before every send.
- A 404 or 410 from a push service deletes that subscription. Endpoints and keys are never logged.
- The VAPID public key comes from `GET /push/public-key`. The web app still reads only `API_INTERNAL_URL` from the environment. `pnpm --filter @kurisu/server push:keys` prints a key pair.
- `POST /push/test` sends a "Notifications are on" message, at most once a minute.
- The web app gets:
  - `app/manifest.ts` (start URL `/chat`)
  - placeholder icons drawn from an SVG of the semicolon-K and gear-ring idea, rendered to PNG with `ImageResponse`
  - `public/sw.js`, registered from the root layout. It shows notifications, and a tap focuses an open window or opens the message's in-app path (Chat by default).

**Alternatives:**
- `web-push`'s own `sendNotification`.
- Writing the RFC 8291 encryption ourselves.
- A `NEXT_PUBLIC_VAPID_PUBLIC_KEY` build variable.
- A third-party push provider.

**Why:**
- `sendNotification` only speaks HTTPS through Node's `https` module, which tests can't point at a plain local fake. Sending ourselves keeps the integration tests honest: they decrypt what was sent, as a browser would.
- A subscription endpoint is a URL the user supplies. Without the allowlist, a crafted subscription could make the server POST to internal hosts.
- Serving the public key keeps the earlier decision that the web app reads no secrets or extra config.

**Consequences:**
- A browser on a push service outside the list can't subscribe until we add its host.
- Changing VAPID keys means every browser subscribes again.
- iOS only allows push for the app added to the Home Screen, and a phone needs HTTPS to install it, so phone testing needs a tunnel or a deployment.

## 2026-10-05 — The morning brief: pg-boss, once per local date, delivered into Chat (Milestone 3)
**Decision:**
- **Scheduler.** pg-boss (a Postgres-backed queue, tables in its own `pgboss` schema) runs inside the server.
  - A `brief-tick` cron job every 5 minutes finds users who are due: brief on, at least one push subscription, and their local brief time passed today in their browser's time zone.
  - It queues one `brief` job each, keyed by user and local date. Failed jobs retry 4 times with backoff.
  - `BRIEF_SCHEDULER=off` stops it, and tests turn it off.
- **Once a day.** A `briefs` row, unique on user and local date for daily briefs, makes each day's brief happen at most once.
  - A brief goes building → ready (chat message saved) → sent. A retry after a failed push resends the push without posting the chat message again.
  - A brief time missed by more than 4 hours (the server was down) skips that day.
  - Each brief covers episodes since the last one, at most 48 hours back.
  - The `briefs` row is the brief's run log: items, summary, model, prompt version, tokens, latency, push counts and an error code.
- **Content.**
  - Only Watching shows (your choice), and only episodes past the user's progress.
  - Back-to-back episodes are grouped, and premieres and finales are marked.
  - A day with nothing new sends nothing (your choice).
  - The notification is templated. The chat message is one summary line from the model (new `brief` role, Flash-Lite, prompt `brief-summary@1`) followed by templated lines.
  - The summary falls back to a template if the call fails, or if the line contains a number that isn't in the brief.
- **Streaming services.** A fixed list of 13 licensed services, mapped to AniList site ids. A show's service is named only when AniList lists an enabled link to one the user picked. Otherwise the line says nothing about where to watch.
- **Brief in Chat.** The brief is saved as an assistant message in the user's current conversation, so the agent sees it in its history and "watched it" or "watched psyren" has context. Tapping the notification opens `/chat`.
- **Settings.** A page off the List header (`/list/brief`, your choice): this device's notifications (on, off, test), brief on or off, time, and services. "Send a brief now" (`POST /brief/test`, once a minute) sends the last 24 hours without using up the day's brief.

**Alternatives:**
- BullMQ (needs Redis).
- graphile-worker.
- An in-process timer.
- Per-user cron schedules.
- A fully templated brief.
- Showing the brief only in the notification.

**Why:**
- pg-boss needs nothing beyond the Postgres we already run, and retries are built in.
- A single 5-minute tick works for every time zone without one schedule per user.
- A unique row in our own table is a stronger once-a-day guarantee than the queue's singleton keys, which only cover queued and active jobs.
- Putting the brief in Chat is what makes the one-step reply work, and the agent didn't need to change.

**Consequences:**
- A brief arrives up to 5 minutes after its time.
- The server must be running for briefs to go out. A laptop that sleeps through the brief time sends it late, or skips the day if it's more than 4 hours late.
- Checked end to end against real AniList and Gemini in an isolated copy:
  - Two shows that premiered that day were mapped and listed.
  - An AniList link marked disabled wasn't named.
  - The model's summary passed the check.
  - The agent resolved "watched psyren" from the brief's title.

## 2026-10-05 — An honest "couldn't update" reply isn't a false claim (Milestone 2)
**Decision:** This refines "Never show a reply that claims an unwritten change". Two changes:
- `claimsChange` ignores a claim verb right after a negation, with only small words between: "could not be updated", "couldn't be updated" (either apostrophe), "hasn't been marked", "wasn't able to get it updated", "nothing changed".
- Each run reports the commits that failed (`commitErrors`). If the reply still claims a change after a failed commit, Chat explains the failure instead of "I didn't change anything… Tell me the show and episode again". For example: "MyAnimeList didn't accept the change, so your list is unchanged. Try again in a minute." The wording matches the web's messages for a failed confirm or undo.

**Alternatives:** Only the negation rule; only the failed-commit message.
**Why:** Seen live: `commit_update` returned `mal_rejected`, and the model replied "PSYЯEN could not be updated right now." The claim pattern matched "updated", so the user was asked to repeat a request the agent had understood.
- The negation rule lets the model's own reply through, which names the show. It also covers refusals where no commit happened.
- The failed-commit message comes from the tool result, not from reading prose, so it is accurate however the model phrases things, even if it falsely says "Updated".
**Consequences:**
- A negated reply the rule doesn't recognize after a failed commit gets the templated failure message, which is still accurate.
- One without a failed commit still gets "nothing changed".
- The negation window is kept tight, so "Not a problem, I've updated it" still counts as a claim.

## 2026-10-05 — A new brief time applies today; the settings page shows where the brief stands (Milestone 3)
**Decision:** This refines "The morning brief: pg-boss, once per local date, delivered into Chat".
- Saving a new brief time or time zone, or turning the brief on, clears today's daily brief if it sent nothing (`empty` or `skipped_late`), so the new time applies today.
- If today's brief went out (`sent`), the new time starts tomorrow, so a day still never gets two briefs.
- `GET` and `PUT /brief/settings` also return:
  - `next`: today, tomorrow, or null when the brief is off.
  - `lastDaily`: date, status and episode count of the most recent daily brief.
- The settings page shows them, e.g. "Next brief: today at 4:50 PM" and "Last brief (today): nothing new had aired, so nothing was sent."

**Alternatives:** Keeping the strict once per day with no feedback; letting every time change send another brief.
**Why:** In the live test, today's brief ran at 4:25 PM and found nothing new, so it sent no notification. Every later test time that day was then ignored, and it looked like the job never fired. Nothing on the page said the brief had run, or when the next one would.
**Consequences:**
- Moving the time later on a day with nothing new can produce one brief later that day.
- The page always says whether the brief ran and when the next one is due.

## 2026-10-05 — Shows AniList splits are joined end to end in MAL's numbering (Milestone 3)
**Decision:**
- When several AniList entries share one MAL id, they're joined in start-date order. Steel Ball Run is the example: a finished 1-episode "1st STAGE", then an airing "2nd & 3rd STAGE" numbered from 1 again.
- The latest part is the one used. Its episode numbers are shifted by the earlier parts' episode counts, which is how MAL counts one entry straight through. AniList's 2nd-stage ep 2 is MAL's ep 3.
- Streaming links are merged across parts.
- It's only done when the join is unambiguous:
  - every part is a series (TV, TV short or ONA) with a known start date, and no two parts start on the same date;
  - every earlier part is finished with a known episode count.

  Otherwise the show is logged ("several AniList entries share this MAL id…") and skipped.
- `anilist_media.episode_offset` stores the shift, so the brief can convert AniList's aired episode numbers.

**Alternatives:**
- Skipping split shows (Steel Ball Run would never be in the brief).
- Using the airing part's own numbering (off by one on MAL).
- Keeping whichever entry came first, which was the old behavior and picked the finished 1st stage.

**Why:** Your choice. MAL keeps such shows as one entry, so straight-through numbering is the only way the brief's "ep 3" and a "watched it" reply match MAL's count. The guards stop a stray movie or recap that maps to the same MAL id from shifting the numbers.
**Consequences:**
- If MAL ever numbers a split show differently, its episode numbers would be off. Nothing checks this, because MAL's API has no per-episode data. With the brief and "the newest episode", that could mean a wrong write.
- A show whose parts can't be joined safely is left out of the brief, as unmapped shows already are.

## 2026-10-05 — "The newest episode" comes from AniList's schedule; prompt v7 (Milestone 3)
**Decision:** This resolves the hold added in "A tie stays a tie; arc-named seasons; 'the newest episode' is held".
- **Search results.** `search_my_list` and `get_entry` show `latest_aired_episode` for shows AniList lists as airing or about to air. It's worked out from the `anilist_media` cache, never by calling AniList during a chat.
- **When it's written.** A "newest episode" message ("watched the newest ep", "the ep that dropped", "caught up on X") is written only when the change lands exactly on that episode. Any other episode, or an unknown latest episode, is held as before (`newest_episode_unknown`).
- **Keeping the cache fresh.** The cache is refreshed by the daily brief, and now also in the background after each list sync (login or re-sync) for Watching, airing and upcoming shows, at most one refresh per user at a time.
- **Prompt v7.** It maps "the newest episode" to `latest_aired_episode` and asks when it's missing. It's registered; v6 stays the app's prompt until a Flash-Lite run of both batches shows v7 keeps zero wrong writes.
- **Evals.** `eval/snapshots/airing.json` freezes AniList's newest episode per airing show (`pnpm eval:airing`, run once on 2026-10-05; it refuses to overwrite). The harness seeds it with each snapshot, and `eval:lookup` and `eval:validate` use it.

**Alternatives:**
- Calling AniList live from the agent.
- A separate `get_airing` tool.
- Letting the model use the episode without the code check.

**Why:**
- A cache read keeps chat fast and the eval offline and repeatable.
- Checking that the write equals the latest episode keeps "the newest episode" from becoming a wrong write when the model guesses (+1 instead of the actual newest).

**Consequences:**
- The answer can be up to a refresh old. The next-episode time in the cache moves "newest" forward on its own once that episode airs.
- Shows without AniList data still get a Confirm card.
- Frozen data for the user's 2 "newest episode" cases: Steel Ball Run ep 3, TYBW Kashin-tan ep 8.

## 2026-10-06 — Prompt v7 becomes the app's prompt (Milestone 3)
**Decision:** Prompt v7 replaces v6. v7 reads "the newest episode" from `latest_aired_episode`.
**Alternatives:** Keeping v6, which always asks about the newest episode.
**Why:** On the same 90 cases (your two newest-episode cases relabeled to the frozen ep 3 and ep 8), Flash-Lite with v7 beat v6 and made no wrong writes, the bar we set for switching.

| | v7 | v6 |
|---|---|---|
| Update accuracy | 96.7% (87/90) | 94.4% (85/90) |
| Wrong writes | 0/64 | 0/63 |
| Clarification precision | 82.6% | 75.0% |

**Consequences:**
- v7's three misses all asked instead of writing:
  - "TYBW s4": the model guessed the wrong Thousand-Year Blood War cour. Its seasons are named after arcs, not numbered, so it asked which one. v6 missed this too.
  - The known Mushoku Tensei follow-up was held.
  - "finished episode 8 of fire force" asked which season. It passed on v6 and in Milestone 2's final run, so it looks like run-to-run variation.
- The Steel Ball Run newest-episode case now writes ep 3.

## 2026-10-06 — Split shows are lined up with MAL's own start date and total (Milestone 3)
**Decision:** This refines "Shows AniList splits are joined end to end in MAL's numbering", replacing its assumption with a check against MAL's data.
- List sync now also stores each show's MAL start date (`anime.start_date`, migration 0010).
- When several AniList parts share a MAL id, MAL's entry is taken to start with the part whose start date is within 2 days of MAL's. It covers that part and every later one, numbered straight through.
  - If that's the 1st stage, the 2nd stage's episodes shift by the 1st stage's count (Steel Ball Run).
  - If it's the latest part, MAL's entry is just that part and nothing shifts.
- When MAL knows the total episodes, the covered parts must add up to it.
- Anything ambiguous is logged and skipped:
  - no full MAL start date;
  - no part starting then, or more than one;
  - an earlier covered part still airing or without a count;
  - a total that doesn't add up.

**Alternatives:**
- Keeping the straight-through assumption.
- Jikan (an unofficial MAL API) for MAL's per-episode list.
- Skipping split shows.

**Why:** You asked to fix the guess. MAL's own start date says which parts its entry covers, it comes from the API we already sync, and it adds no new data source.
**Consequences:**
- Split shows resolve only after a list sync has stored MAL's start date (any login or re-sync).
- Until then they're skipped, like unmapped shows.

## 2026-10-06 — "Watched it" after a brief means caught up on everything in it; prompt v8 (Milestone 3)
**Decision:**
- **The rule (your decision).** Right after a morning brief, "watched it" (also "watched them all", "saw both", "caught up") means caught up on every show the brief listed, up to the last episode listed for each.
- **Brief context.** Chat finds the brief the message replies to: the conversation's last message, linked from `briefs.chat_message_id`. It passes the agent each show and its last listed episode. Brief replies get 10 agent turns instead of 6, since each show needs a search, proposal and commit.
- **The check.** For such a reply, a change is written only when it lands exactly on the brief's last episode for that show. Anything else is held with the new reason `not_in_brief`: one more episode instead of all of them, or a show the brief didn't list. This rule takes precedence over the "newest episode" one, since more may have aired since the brief.
- **The hint.** Every brief in Chat now ends with: Reply "watched it" once you've caught up on all of these.
- **Prompt v8** adds the rule. It's registered; v7 stays current until v8 is checked on the batches.
- **Evals.** The harness reads a brief from a case's history text (`parseBriefText`), and the validator warns about brief-reply cases that expect a held write.

**Alternatives:**
- Making "watched it" mean only the next episode of each show.
- Asking which shows every time.
- A code path that writes brief replies without the agent.

**Why:**
- Weekends often drop several episodes at once, and "watched it" should cover them in one reply, as the design's one-step reply intends.
- The code check makes the episode numbers exact whatever the model does.
- Keeping the agent in the loop handles phrasing variety, and the eval measures it.

**Consequences:**
- A reply naming one show ("watched frieren") still follows the "just watched X = next episode" rule.
- Brief replies have no eval cases yet.

## 2026-10-06 — Prompt v8 becomes the app's prompt (Milestone 3)
**Decision:** Prompt v8 (the "watched it after a brief" rule) replaces v7.
**Alternatives:** Waiting for your brief-reply eval cases before switching.
**Why:** On the 90 batch cases, Flash-Lite with v8 matched v7 and made no wrong writes: 96.7% (87/90), 0/65 wrong writes, precision 81.8% (v7: 96.7%, 0/64, 82.6%). Without the rule, "watched it" after a brief depends on the model guessing what you mean. The `not_in_brief` check guards the episode numbers either way.
**Consequences:** Brief replies are still unmeasured until there are eval cases for them. The misses were the same kinds as v7's: the Mushoku Tensei follow-up and "TYBW s4" were held, and "watched bleach episode 380" was refused without asking.

## 2026-10-06 — Your full rules for replying to a brief; prompt v9 (Milestone 3)
**Decision:** This extends "'Watched it' after a brief means caught up on everything in it; prompt v8" with the rules your 35 brief-reply cases call for. Right after a brief, for the shows it listed:

| Reply | What's written |
|---|---|
| Whole brief: "watched it", "watched them all", "done", "finished", "caught up", "saw them", "watched the eps" | Each show up to the last episode the brief listed |
| A show named without a number ("watched wistoria") | That show up to its last listed episode |
| A count ("a wistoria ep", "one ep", "3 clevatess") | That many more, never past the last listed episode |
| An episode number ("ep 8", "the 2nd ep", "the first ep", "the premiere") | That episode, only for the show the brief listed it for |
| "Haven't seen them", "didn't watch any yet" | Nothing |

- `agent/briefReply.ts` decides which rule a message follows. `propose_update` holds any progress the rule doesn't allow (`not_in_brief`).
- "Watched it" still can't touch a show the brief didn't list.
- Prompt v9 spells the rules out for the model. The validator applies the same rules.
- You chose that "watched 3 clevatess" means 3 more episodes.

**Alternatives:** Only checking "watched it"-style replies (v8's check); asking whenever a reply names a show.
**Why:** Your priority is no wrong writes. The check stops the likely mistakes even when the model gets one wrong: "the 2nd ep" written to the second show in the list, "ep 8" applied to One Piece, a count running past the brief, or progress on "haven't seen them".
**Consequences:**
- A count only allows episodes up to the brief's last one. "Watched 5 more" when the brief lists fewer is held.
- A mixed reply that negates watching ("watched wistoria but haven't seen daemons") holds everything, which is safe but asks more.

## 2026-10-06 — A reply to a brief can only change the shows it names; misspelled fields are rejected (Milestone 3)
**Decision:**
- **Named shows only.** When a reply to a brief names shows ("watched daemons and clevatess"), only those shows can get progress. Any other show from the brief is held, with the new reason `not_named` ("You didn't mention this show, so check it").
  - A show is named when a word in the reply matches one of its titles, its English title or a nickname, as a whole word or a prefix. "Daemons" matches Yomi no Tsugai through "Daemons of the Shadow Realm".
  - Exempt: whole-brief replies, "the other two" / "the others" / "both" / "all", and episode numbers ("the 2nd ep").
  - The validator applies the same rule.
- **Misspelled fields.** `propose_update` rejects unknown fields and names them for the model ("Unknown field Episodes_watched…"), instead of silently dropping them.

**Alternatives:** Relying on the prompt; asking whenever a reply names shows; leaving extra fields ignored.
**Why:** In the Flash-Lite runs on all 130 cases, each prompt made one wrong write the earlier checks missed:
- v9 wrote Wistoria for "watched daemons and clevatess", after searching only the brief's titles.
- v8 wrote only a status for "started omp 3", because it misspelled `episodes_watched`.

Both are now structural checks, so no prompt can repeat them.

**Consequences:**
- A reply naming a show by a word that isn't in any of its titles or nicknames holds that show. That's safe, but it's an extra question.
- A model that misspells a field gets one more turn to fix it.

## 2026-10-06 — Prompt v9 becomes the app's prompt (Milestone 3)
**Decision:** Prompt v9 (your full brief-reply rules) replaces v8.
**Alternatives:** Keeping v8.
**Why:** With the named-show and field-name checks in place, Flash-Lite on all 130 cases made no wrong writes with v9.

| | v9 | v8 |
|---|---|---|
| Batches | 85/90 (94.4%), 0/63 wrong writes | 84/90 |
| Your brief replies | 34/35 (97.1%), 0/57 wrong writes | 30/35 |
| Wrong writes overall | 0/123 | 1/120 ("the eater one" written as Soul Eater instead of asking) |

**Consequences:**
- Every v9 miss asked or held instead of writing: "watched both eps" asked which Bleach entry, and the usual flaky batch cases (MHA More, Mushoku Tensei follow-up, TYBW s4, Cowboy Bebop rewatch, Bleach ep 380).
- Which batch cases miss varies from run to run, by about ±2 cases.

## 2026-10-06 — Milestone 3 is done (Milestone 3)
**Decision:** Milestone 3 counts as done (your call).
- A daily pg-boss job builds each brief from AniList schedules and your Watching list, names only your streaming services when AniList has an active link, and sends a web push. Tapping it opens Chat, where the brief waits.
- Verified live on desktop Chrome, including the daily job and replying in Chat.
- Follow-ups shipped in the same milestone:
  - "the newest episode" answered from AniList (prompt v7);
  - split shows lined up by MAL's start date;
  - your rules for replying to a brief (prompt v9), with code checks for named shows and episode numbers.
- Flash-Lite with v9 on all 130 eval cases: 0 wrong writes; brief replies 34/35.

**Alternatives:** Hosting the app first, so phone push could be tested.
**Why:** Every done-when criterion is met. Phone push needs HTTPS hosting, which Milestone 5 (the friends beta) needs anyway.
**Consequences:**
- Briefs depend on this PC running.
- Phone push is still untested.
- The icons are placeholders.
- Case 9 (a message between the brief and the reply) isn't covered.

## 2026-10-06 — Show details from MAL and rating patterns by genre (Milestone 4)
**Decision:**
- **Show details.** List sync also asks MAL for each show's `genres`, `average_episode_duration` and `mean`. They're stored as `anime.genres`, `anime.episode_minutes` and `anime.mal_mean`. A 0 duration or score means MAL doesn't know yet, so it's stored as null.
- **Rating patterns.** `taste_genres` holds, per user and genre:
  - how many of its shows you scored, and your mean score for them;
  - how many you dropped;
  - an affinity: your genre mean minus your overall mean, times scored / (scored + 5).
- **Refreshing.** It's recomputed in SQL from the mirror after each list sync (in the background, beside the airing refresh) and before each recommendation.

**Alternatives:**
- AniList's genres and tags.
- Raw per-genre averages with no shrinkage.
- Computing patterns on the fly with no stored table.

**Why:**
- MAL is the list of record, and its genre list already mixes in themes such as Iyashikei, which are useful for moods.
- Shrinkage keeps one 10/10 in a rare genre from dominating the patterns.
- A stored table is what the design means by taste memory, and what the Taste page shows.

**Consequences:**
- The new fields fill in on the next sync.
- Genres from sources that aren't MAL aren't used.

## 2026-10-06 — Drop reasons: a category plus your own words, only when you give one (Milestone 4)
**Decision:**
- `propose_update` takes an optional `drop_reason` category (pacing, story, characters, art_animation, too_long, lost_interest, other). It's only allowed with status dropped.
- The words stored are always your message, never the model's paraphrase.
- The reason is saved to `drop_reasons` when the drop commits, linked to its change. Undoing the drop removes it.
- A drop with no reason records nothing, and the agent never asks (your choice).

**Alternatives:**
- Asking why after every drop.
- Storing the model's summary.
- Free-form reasons with no category.

**Why:**
- You prefer fewer questions.
- Your own words can't be an invented reason.
- A category is something the recommender can act on, such as avoiding slow shows.

**Consequences:** The 4 existing drops have no reasons. Reasons accumulate as you drop shows and say why.

## 2026-10-06 — Recommendations: a handoff to a separate agent, ranked in code, picks checked (Milestone 4)
**Decision:**
- **Routing.** The progress agent gets a `recommend_shows` tool. When a message asks what to watch, it makes any updates first, then hands over.
  - Chat then runs a separate recommendation agent (prompt `recommend.v1`) on the `recommend` role, Flash per the design.
  - Its reply follows the update's in one chat message.
  - Both runs are logged; the recommendation run is linked by `handed_off_from_run_id` and has the outcome `recommended`.
- **`find_candidates` (code).**
  - Filters your Plan to Watch and in-progress shows (Watching, On Hold, rewatching; never completed, dropped or unaired) to the constraints: time available, episodes left, genres wanted or avoided, media type, which list.
  - Ranks by taste fit (genre affinities), MAL score, a nudge for shows under way or airing, and penalties for genres you drop and, after "too long" drops, long shows.
  - Returns the top 15 with plain facts behind each.
  - Unknown genre names are reported back with the genres on your list.
  - The loop is shared with the progress agent (`agent/toolLoop.ts`), so both log the same way.
- **`present_picks`** stores up to 3 picks (your choice) in `recommendations`. Each must be a show a search in this run returned, with a one-line reason. Chat shows them as cards: cover, list status and progress, episodes left × length, the reason.

**Alternatives:**
- One agent with all the tools.
- Classifying intent with a separate model call first.
- Letting the model rank the whole backlog itself.
- Free-text recommendations.

**Why:**
- The handoff keeps the progress agent's tested behavior and handles mixed messages without an extra call.
- Ranking in code makes the constraints hard rules and keeps the model's job to mapping words to constraints and explaining picks.
- Checked picks can't recommend a show that isn't on your list.

**Consequences:**
- A recommendation takes two model runs, the second on Flash.
- Prompt v10 (the handoff and drop reasons) has to become the app's prompt for recommendations to work. That's gated on the 130 update cases.

## 2026-10-06 — Prompts v10 and v11; brief titles count as your words; v11 becomes the app's prompt (Milestone 4)
**Decision:**
- **v10** adds the `recommend_shows` handoff and `drop_reason` to v9.
- **v11** adds two things for replies to a brief: search with your own words for a show (nicknames like "daemons") as well as the brief's title, and "finished" means caught up, not completed.
- **Code:** in a reply to a brief, the brief's own titles count as your words for search, since you're answering a message that named them. A search for a brief title is then settled by its exact name, even when the model also guesses other seasons of the same show.
- v11 becomes the app's prompt.

**Alternatives:** Shipping v10 as it was; changing the conflicting-guesses rule for everyone.
**Why:** Flash-Lite on all 130 cases. v10 kept 0 wrong writes, but both of its runs got 2–3 of your brief replies fewer than v9: it asked about "Bleach Kashin-tan" because of its own wrong cour guesses, searched the wrong show for "daemons", and read "finished them" as Completed.

| Prompt | Accuracy | Brief replies | Wrong writes |
|---|---|---|---|
| v9 | 122, 123 /130 | 34, 34 /35 | 0 |
| v10 | 120, 119 /130 | 32, 31 /35 | 0 |
| v11 + the search change | 124/130 | 35/35 | 0/123 |

**Consequences:**
- The remaining misses all ask or hold: MHA More, the Mushoku Tensei follow-up, TYBW s4, the Cowboy Bebop rewatch, and "final mha season".
- The search change only applies when your message replies to a brief.

## 2026-10-06 — Multiple chats with a history sidebar (Milestone 4)
Requested during Milestone 4, outside its scope.

**Decision:**
- **Chats.** A chat starts with its first message. Its title is that message, cut at a word near 60 characters, with no model call.
- **Sidebar.** It sits beside the chat on wide screens and is a drawer on phones. It lists chats by latest message under Today, Yesterday, Previous 7 days and Older, with New chat and delete. `/chat` opens the most recent chat.
- **Briefs.** Each brief starts its own chat, titled "Brief, Oct 6", and the notification opens it. This replaces "saved as an assistant message in the user's current conversation" from the Milestone 3 brief entry.
- **Deleting a chat** cancels the changes it held for confirmation. The changes it made stay in the change log and can still be undone there.

**Alternatives:**
- Titles written by the model: a call per chat, and it could misdescribe.
- A new chat on every launch, like ChatGPT: it would hide the morning brief and pending confirmations.
- Posting briefs into the latest chat: a reply could land in an unrelated thread.

**Why:** You asked for new chats and a history sidebar like other AI apps. Separate chats also keep the agent's context on topic, since it only sees the last 6 messages of the chat it's in.

**Consequences:**
- `POST /chat/messages` takes an optional `conversationId`; without one it starts a new chat.
- `GET /chat/conversations` and `GET /chat/conversations/:id` replace `GET /chat`, and `DELETE /chat/conversations/:id` deletes one.
- Renaming a chat isn't built yet.

## 2026-10-06 — Renaming chats (Milestone 4)
**Decision:** Each chat in the sidebar has a rename button that turns its name into a text box: Enter or leaving the box saves, Escape cancels. `PATCH /chat/conversations/:id` takes `{ title }`, kept on one line and between 1 and 100 characters. This follows up "Renaming a chat isn't built yet" in the multiple-chats entry.
**Alternatives:** A menu per chat with Rename and Delete; renaming from the chat's header.
**Why:** You asked for it. Two small buttons on each row are one tap on a phone, where a menu would be two.
**Consequences:** A renamed chat keeps its name; a new message doesn't change it.

## 2026-10-06 — Show cards for the shows a reply names (Milestone 4)
**Decision:** When an agent reply names a show, it gets a card: cover, title, and where you are in it, or "Not on your list".
- **Which shows count:** only shows the run looked up (search or `get_entry`), named as whole words (title, English title or a synonym). The longer name wins where names overlap, and a one-word name must keep its capital.
- **Skipped:** shows that already have a change, Confirm or pick card in the same message. At most 5.
- **Answering by tap:** when the reply asks a question and is the latest message, the cards are buttons. A tap sends the show's exact title as your reply, which the agent already treats as settling its question.
- **Storage:** `chat_messages.show_ids`.

**Alternatives:** A tool the model calls to attach cards: it needs a prompt change and the model has to remember to call it. Cards for every show the run looked up, named or not: they'd show shows the reply didn't talk about.
**Why:** You asked for cards when the agent asks or talks about a show, with a tap to answer. Matching names in code works with today's prompt and can't attach a show the run never saw.
**Consequences:** A reply that shortens a title ("Frieren S2") gets no card for it. Shows found outside your list (adding shows, next) get cards the same way.

## 2026-10-06 — Adding shows to the list, always confirmed (Milestone 4)
**Decision:**
- **What Chat can add:** shows that aren't on your list. "add X" means Plan to Watch. "watched ep 3 of X" or "finished X, 8/10" adds it with that progress and score (your choice).
- **Every add waits for your tap, enforced in code:** `propose.ts` makes any proposal for a show not on the list an add, with `requires_confirmation` set and reason `adds_to_list`. The model can't skip it, whatever it calls. That includes anything the agent decides is an add (your rule).
- **The confirm card for an add is a show card:** cover, title and episodes, with a button worded as the action ("Add to Plan to Watch", "Add as Completed, 8/10").
- **Finding the show:** a new tool, `search_anime`, searches AniList by title in one request, leaving out adult titles. It reuses the list search's clear-match rule, so a vague name gets a question with cards. Results become provisional `anime` rows from AniList, never overwriting MAL's rows. Right after an add commits, MAL's own details replace the provisional row (sync after a write).
- **New write kinds:** `proposals.kind` and `changes.kind` are update, add or remove. An add has no "before".
  - Committing an add is refused if the show reached the list meanwhile.
  - Undoing an add removes the show from MAL (a new `deleteListStatus`, still only reachable through `commit.ts`). It's refused once the entry has changed, since removing it would lose that.
  - Undoing the removal puts the show back.
- **Prompt:** the tool is offered only to prompts that list it in `tools` (v12 on), so older prompts' evals stay comparable.
- **Eval:** cases can expect `adds`, resolved against a frozen copy of AniList's title searches (`pnpm eval:catalog`).

**Alternatives:**
- MAL's own search: live MAL reads, with limits MAL doesn't publish.
- Auto-committing clear adds like updates: rejected by your "always ask when adding".
- A confirm button that calls the server without the agent.

**Why:** You asked to add shows from Chat, carefully. Enforcing the hold in the write path keeps the rule true whatever the model does, and the change log keeps every add undoable.
**Consequences:**
- Adding takes two steps: the message, then a tap.
- Shows found but never added leave provisional rows in `anime`, which is harmless.
- AniList being down means Chat can't find new shows, and says so.

## 2026-10-06 — Prompt v12 becomes the app's prompt (Milestone 4)
**Decision:** v12 (v11 plus `search_anime` and the rules for adding shows) is the app's prompt.
**Alternatives:** Keeping v11 and offering adds later.
**Why:** On Flash-Lite over all 130 of your cases (none of them about adding yet), v12 keeps 0 wrong writes and scores better than v11's last run. Clarification precision is the same. Every miss asks or holds instead of writing: Mushoku Tensei, TYBW s4, the example multi-sequel, and one brief reply ("watched ep 8" got "which show?"; v11 got it in its run).

| Prompt | Accuracy | Brief replies | Wrong writes | Clarification precision |
|---|---|---|---|---|
| v11 | 124/130 | 35/35 | 0/123 | 71.4% |
| v12 | 126/130 | 34/35 | 0/125 | 71.4% |

**Consequences:** Adding shows works in Chat now. Your add cases come next, after the frozen catalog is built from their titles.

## 2026-10-06 — Your add cases, prompt v13, and two search fixes (Milestone 4)
**Decision:**
- **Your 10 add cases** are in `eval/cases/adds.yaml`. The wordings and outcomes are yours; I suggested the scenarios and shows, and froze their AniList searches.
- **Your decisions for these cases:**
  - "started mushishi" and "watched 5 eps of Natsume Yuujinchou" ask which entry. This is the same rule as your list: an exact name that later seasons start with asks.
  - "add X" for a show already on your list changes nothing and asks nothing.
  - "gonna start X" for a show not on your list means Plan to Watch.
- **Prompt v13** adds three rules:
  - "gonna start X" means Plan to Watch for a show not on your list.
  - When several shows outside the list fit, ask a real question naming them.
  - Never call an add done before you tap.
- **Search outside the list:** a series' own movies and specials no longer stop its exact name from being clear (The Tatami Galaxy vs its Specials). Other TV seasons still do (Mushishi). Searches of your own list are unchanged.
- **`search_anime` also returns matches from your list,** scored with the rest. A show you have is then found and updated, not added, even if the model skips `search_my_list`.

**Alternatives:** Keeping v12; fixing the skipped list search in the prompt only.
**Why:** First run of your add cases on v12: 6/10. The misses were Tatami Galaxy and Shirobako (blocked by their specials and movies), Mushishi (a statement, not a question), and Look Back (added as ep 1, not Plan to Watch). v13 alone then skipped `search_my_list` for "started X" and said shows you have weren't on your list. That would have been an eval artifact in production, since AniList also returns your shows, but a tool shouldn't rely on it. With both fixes, on Flash-Lite over all 140 cases:

| Prompt | Accuracy | Add cases | Brief replies | Wrong writes |
|---|---|---|---|---|
| v12 (earlier tools) | 126/130 + 6/10 | 6/10 | 34/35 | 0 |
| v13 (fixed tools) | 136/140 | 10/10 | 35/35 | 0/126 |

**Consequences:**
- v13 is the app's prompt.
- The remaining misses all ask or hold: bsd ep 5, Mushoku Tensei, TYBW s4, and the Cowboy Bebop rewatch.
- In that last one the model said "tap Add" for a Confirm card, a wording slip.

## 2026-10-06 — Recommendations beyond your list (Milestone 4)
**Decision:**
- **Discovery pool:** recommendations also draw from shows new to you, kept per user (`discovery`) and built in the background after a list sync, at most daily. Show details are shared in `anilist_catalog`. Three sources:
  - AniList's "fans also liked" lists for your 25 highest-scored completed shows. Each seed's top pick counts 1, the next ½, then ⅓, and so on.
  - The 50 top-rated shows in the 3 genres you rate highest (enough scored shows, above your average).
  - The 50 top-rated movies.

  The top-rated lists count less than fans' picks, and only reasonably popular shows go in.
- **Out of the pool:** adult titles, unaired shows and shows without a MAL entry. At ranking time, anything on your list in any status, and sequels to shows you haven't completed (AniList's prequel links), are left out too.
- **Translation:** AniList's genres and main tags (rank 60+, not spoilers) are translated to MAL's names, so moods and filters work the same.
- **Ranking:** one ranking for both. Your list gets a +1 boost (your choice: list first). A new show adds up to +0.5 for how strongly AniList points at it, so it wins only on a clearly better taste fit, or when your list has nothing that fits. `find_candidates` gains `from: new`.
- **Prompt:** `recommend.v2` says which list a pick comes from, maps "something new / I haven't seen" to `new`, and never claims to add anything.
- **Cards:** a new pick says "New to you" and has "Add to Plan to Watch", which sends that request through Chat's always-confirmed add.

**Alternatives:**
- AniList calls during each recommendation (3 s or more per request, rate-limited).
- MAL's suggestions endpoint (live MAL reads, undocumented limits).
- Popularity-only picks (generic, not your taste).
- A smaller list boost: at +0.5, well-rated new shows outranked your list in tests.

**Why:** Asking for "a movie" found nothing, because your Plan to Watch and in-progress shows have no movies. You chose to look beyond the list with the list first. Building the pool ahead of time keeps recommendations fast and repeatable, and the AniList links make picks personal: fans of your favorites.

**Consequences:**
- The pool exists only after a list sync, so press Re-sync once.
- The recommendation eval needs the pool frozen too (next PR).
- New picks rest on AniList's community data, which their facts show ("AniList score 8.4", "fans of X also like it").

## 2026-10-06 — The kind of show asked for is never loosened; recommend.v3 (Milestone 4)
**Decision:**
- **The type you ask for is a hard requirement:** "a movie" means movies only. Prompt `recommend.v3` may loosen the time or mood when nothing fits, never the kind of show. "A show" or "a series" maps to TV and web series, as "a movie" maps to movies.
- **A pool still being built is said so:** until your discovery pool has been built once, `find_candidates` notes that new shows are still being gathered, and the reply tells you to ask again in a minute.

**Alternatives:** Letting the model loosen any constraint, as v1 and v2 did.
**Why:** Your first try, "what movie should I watch tn", came 17 seconds after your re-sync, while your first pool was still building (it took about 45 s). With no movie on your list, v2 "loosened the least important constraint" and recommended two specials and an episode. As you put it, movies when asked for movies, shows when asked for shows.
**Consequences:** A movie request with no movie that fits gets an honest "nothing fits" instead of something else.

## 2026-10-06 — List filters run in the browser (Milestone 4)
**Decision:**
- **What you can filter:** within each status tab, the List screen filters by title (main, English and synonyms), type, genre and airing state, and sorts by recent update, title, your score, MAL score or shortest.
- **Where it runs:** filtering happens in the browser on the list the page already loaded. The view lives in the URL through `history.replaceState`, so a reload keeps it.
- **Across tabs:** filters stay set when you switch tabs, and each tab's count shows its matches.
- **What it needed:** `/list` entries gained `altTitles`, `genres`, `episodeMinutes` and `malMean`.

**Alternatives:** Filtering on the server through query parameters, which costs a round trip for every keystroke and tab switch.
**Why:** A list of a few hundred shows filters instantly in the browser. The page already loads the whole list.
**Consequences:** A list in the many thousands would need server-side paging and filtering. The genre menu lists only genres present in the tab, with counts.

## 2026-10-06 — No sampling settings in model requests (Milestone 4)
**Decision:** Model requests no longer carry a temperature. `ChatRequest` loses its `temperature` field, so no caller can set one. Gemini gets no `temperature`, `top_p`, `top_k` or thinking budget, so each model uses its own defaults. Ollama keeps a fixed temperature of 0, which keeps local eval runs repeatable.
**Alternatives:**
- Keep the field and have the Gemini provider ignore it, which would be a setting that silently does nothing.
- Send `thinking_level` explicitly, which would change behavior that the evals have already measured.
**Why:** Google wrote that newer Gemini models will answer these fields with a 400 error, and that Gemini 3.6 Flash and later already ignore them. We sent temperature 0 on every call (0.4 for brief summaries) and never set a thinking budget.
**Consequences:**
- Flash-Lite (3.5) predates 3.6 and may have honored temperature 0, so the eval was rerun without it.
  - On all 140 cases: 133/140 correct and 1 wrong write, against 136/140 and 0 before.
  - The wrong write was "the eater one" taken as Soul Eater. It also happens at temperature 0: 2 times in 8 runs of that case, either way. The difference is run-to-run noise, not this change, and that weakness is tracked separately.
- Brief summaries lose their 0.4 setting; the summary check still guards their content.
- Moving to the Interactions API is a separate choice; `generateContent` remains supported.

## 2026-10-06 — The Taste page shows taste memory, and deleting a drop reason only forgets it (Milestone 4)
**Decision:** `/list/taste` shows:
- your average score;
- the genres you rate most above and below it (up to 8 each, as bars of the shrunk affinity the recommender uses);
- a table of every genre;
- your drop reasons, newest first.

Deleting a drop reason (`DELETE /taste/drop-reasons/:id`) removes it from taste memory only; your list on MAL stays as it is. The drop categories moved to the shared contract, so the page and the agent's tool use the same list.
**Alternatives:**
- Showing raw genre averages instead of affinity, which would disagree with how recommendations rank.
- Undoing the drop along with its reason, which History's undo already does.

**Why:** The page should explain the numbers recommendations actually use. Forgetting a reason is about taste, not about your list.
**Consequences:** A drop reason can't be edited, only deleted; dropping the show again with a new reason records a new one.

## 2026-10-06 — Taste refreshes run one at a time per user (Milestone 4)
**Decision:** `refreshTaste` takes a transaction-scoped Postgres advisory lock keyed on the user before it deletes and re-inserts their `taste_genres` rows.
**Alternatives:**
- Upserting with `ON CONFLICT`, which can leave rows for genres that no longer apply when two refreshes overlap.
- Retrying on a duplicate-key error.

**Why:** CI caught two overlapping refreshes failing with a duplicate key. A refresh after a sync and the one at the start of each recommendation can overlap in the app too, and the recommendation would then fail.
**Consequences:** A second refresh waits for the first, then recomputes from the committed data.

## 2026-10-06 — Recommendation eval: labels on picks, with frozen show details and pool (Milestone 4)
**Decision:**
- **Format:** recommendation cases live in `eval/cases/recommend-*.yaml`. Each has a message and labels: `media_types`, `max_episode_minutes`, `genres_any`, `genres_none`, `source` (list, plan_to_watch, in_progress, new or any), `must_not` and `picks: false`.
- **Runner:** `pnpm eval:recommend` runs the real flow (the progress agent, then the handoff, then the recommender) against the my-list snapshot.
- **A case is right when:** the message reached the recommender, it got picks, and every pick is valid and within the hard labels. Genre fit (`genres_any`) is reported but doesn't fail a case.
- **Frozen data:** show details (MAL genres, episode length, community score) and the discovery pool (AniList data plus strength) are frozen once in `snapshots/details.json` and `snapshots/discovery.json` by `pnpm eval:recommend-data`.

**Alternatives:**
- Comparing picks with an expected list of shows, which breaks whenever the ranking changes and has many right answers.
- Grading picks with a model, which costs more and is less repeatable.
- Freezing taste memory or the favorites behind each pool show, which would publish your rating patterns in a public repo.

**Why:** Labels describe what the request demands, and a pick either meets them or doesn't, so the score holds up as ranking changes. Freezing the details and pool makes runs repeatable without AniList or MAL calls.

**Consequences:**
- Taste is neutral in the eval, since the snapshot has no scores. It measures following the request, not personal fit.
- The pool reflects the day it was frozen; re-freezing (`--force`) means re-checking cases that name pool shows.
- A first run of the 3 format examples on Flash-Lite plus Flash: 3/3 right, 9/9 picks valid and within labels, median 10.4 s, about 1¢ a case.

## 2026-10-06 — A clear match must be grounded in your words (Milestone 4)
**Decision:** This refines "The model's guesses can't decide between seasons". A title the model supplied only makes a show clear when your own words point at that show. Your words are this message, your earlier messages in the chat (never the agent's), and a brief's titles when you reply to it. A model's query counts when one of these holds:
- **Your words, rearranged.** Every word of the query is in one of your messages ("isekai chronicles season 2" for "season 2 of isekai chronicles"). Such a search also isn't "all guesses".
- **You named the show.** One of its names is in one message as whole words, or one word is the initials of a name of 3+ words ("ylia", "mha", "cote", "sds"; a leading "The" and everyday words don't count).
- **You named another season, and code picked this one.** It's the only season in progress ("bsd" is only season 1's nickname), or it has the season or part number the query has, which the same message gives ("cote s4"). Bare numbers like "a 10" or "3 eps" aren't season numbers.

Anything else is held as `ambiguous_match`, and the agent asks. A query that is your words as they stand, which includes the brief's titles in a reply, works as before. There's no prompt change.

**Alternatives:**
- Only your rule as first stated (the whole name, or the query, in the message): this breaks "bsd", which you wanted kept.
- Tolerating typos ("Hoyuka" → Hyouka): you chose to have those ask.
- Word overlap: "eater" would ground Soul Eater.

**Why:** "Starting devilman crybaby and the eater one" wrote Soul Eater in about 2 of 8 Flash-Lite runs. The model turned "the eater one" into "Soul Eater", an exact name, so search marked it clear. You'd rather answer a question than get a wrong write.

**Consequences:**
- A free replay of every search in the last 5 full Flash-Lite runs (615 committed writes) with the new rule:
  - The Soul Eater write turns into a question.
  - So do the typos "omp 3" and "Hoyuka", "Tenjiku arc" (the model searched "Tokyo Revengers Tenjiku Arc"), "the final mha season" (word order) and "TYBW s4".
  - Nothing else changes: bsd, MHA More, cote s4, ylia, sds season 3, "actually I meant ep 38" and every brief reply still write.
- Live, on Flash-Lite with progress-sync v13, all 140 cases:

  | Run | Accuracy | Wrong writes | Clarification precision | Clarification recall |
  | --- | --- | --- | --- | --- |
  | before, temperature 0 | 136/140 | 0/126 | — | — |
  | before, no temperature | 133/140 | 1/125 (Soul Eater) | 74.3% | 96.3% |
  | **with this rule** | **133/140** | **0/123** | **71.1%** | **100%** |

  - The new misses are the expected questions: omp 3, Hoyuka, the final mha season and Tenjiku arc.
  - The other three misses are older ones, where the rule changed nothing: bsd ep 5 (the model asked), Mushoku Tensei (dropping by tie-break is held) and TYBW s4. In TYBW s4, the rule blocked the model's own wrong cour, Soukoku-tan.
  - The devilman case ran 8 more times. It wrote Devilman every time and Soul Eater never; in 6 of those runs the model searched "Soul Eater" and then asked.
- The rule only removes clear matches. The one exception is a search of your rearranged words, and any show that makes clear is one your words name.
- Two tests changed:
  - A show neither a brief nor the reply names is now held as "Not sure this is the show you meant" instead of "Your brief didn't list this episode".
  - "watched it" two messages after a brief no longer reaches a show nobody named.

## 2026-10-07 — Time grace in code, queued shows apart from started ones; recommend.v4 (Milestone 4)
**Decision:**
- **Time:** shows that fit the time come first. Only when fewer than 3 fit does `find_candidates` add shows up to 5 minutes over (`TIME_GRACE_MINUTES`), after the ones that fit and marked with how far over they run. Prompt `recommend.v4` never searches with more minutes than you gave, and says when a pick runs a little long. If nothing fits even then, it says so and picks nothing.
- **Queued shows:** Watching or On hold at episode 0 is a new pool, `queued` ("queued on your Watching list, not started yet"), apart from `in_progress`, which now means started. "Continue what I started" searches `in_progress` only.
- **Plan to Watch:** "From my plan to watch" means Plan to Watch only; "from my list" covers Plan to Watch, started and queued.

**Alternatives:**
- Letting the model loosen the time freely (v3), which turned "10-15 mins" into 25-minute episodes.
- Never going over the time, which loses the 16-minute show for "10-15 mins".
- Leaving ep-0 Watching shows in progress.

**Why:** Your rules, from your recommendation cases: a time limit comes first, with a few minutes of grace for intros and outros; and Watching at episode 0 is your queue, not something you started. The grace sits in code, so the model can't stretch it further.

**Consequences:** On your 25 cases, v3 got 23/25 and v4 gets 25/25: every pick valid and within your labels, genre fit 30/30, median 11.6 s, about 1.2¢ a case.

## 2026-10-07 — Year ranges in recommendations; recommend.v5 (Milestone 4)
**Decision:**
- **Years asked for:** `find_candidates` takes `year_from`/`year_to` (the year a show started airing: MAL's start date for list shows, AniList's for new ones) and an `era`. "Old" or "classic" means before 2000; "recent", "newer" or "latest" means the last 5 years, counted from today's date in code.
- **Grace:** shows inside the years come first. When fewer than 3 fit, shows up to 2 years outside fill in (`YEAR_GRACE`), marked as such, the same way as the time grace.
- **"New":** "something new" still means new to you. When "new" could mean either new to you or recently aired, `recommend.v5` asks which.

**Alternatives:**
- Strict years, which you turned down for "a year or two of grace".
- Having the model work out "recent" itself, which needs today's date in the prompt and isn't testable in code.

**Why:** You asked for year ranges, and chose the meanings of "old", "recent" and "new" and the grace.

**Consequences:**
- The eval's frozen `details.json` gained start dates (`pnpm eval:recommend-data --fill-start-dates`; 347 of 348 shows).
- New labels: `year_from`, `year_to`, `grace_years`, and `clarify` for "should ask".
- Your 25 cases stay 25/25 on v5.
- "any new anime?" on its own doesn't reach the recommender: the progress agent answers it with an offer. Handing it over would need a progress-sync change and a full eval run.

## 2026-10-07 — Faster recommendations: low thinking, and the reply rides on present_picks; recommend.v6 (Milestone 4)
**Decision:**
- **Thinking level per role:** `config/models.json` gains a `thinking` section, a Gemini thinking level per role. The recommender runs on `low`; every other role keeps its model's default. `ChatRequest.thinking` reaches Gemini as `thinkingConfig.thinkingLevel`, the supported setting since thinking budgets are deprecated.
- **No extra turn:** `present_picks` takes the one-sentence reply, and showing picks ends the run. Prompt `recommend.v6` passes it there instead of answering in a turn of its own.

**Alternatives:**
- Flash-Lite as the recommender (cheaper, but no measured result yet).
- `minimal` thinking (not tried).
- Skipping the progress agent for plain recommendation requests (it takes only about 0.7 s).
- Streaming the reply to the screen.

**Why:**
- Your real recommendations took 16–18 s. Most of it was the recommender's second model call: 1,200–1,600 output tokens, almost all of them thinking, to write about 150 tokens of picks.
- A third call of about 2 s only wrote the reply sentence.

**Consequences:**
- Your 25 cases: still 25/25. Median 12.3 s became 6.1 s (p90 17.9 s became 12.8 s), and the cost per case went from 1.25¢ to 0.54¢.
- Slower cases now come from Gemini's own response times, or from an update made in the same message.
- Older prompts still reply in their own turn, since the run only ends early when `present_picks` gets a reply.

## 2026-10-07 — In-app editing and import; Milestone 5 "Your list, in your hands" inserted (Milestone 5)
**Decision:** This reverses the design doc's goal of "natural-language updates … with no manual list editing". The user can now edit entries on the List screen and import an unstructured list from their notes. Both use the same write path as the agent: a proposal, then `commitProposal`, logged with prior values and undoable. A new Milestone 5 holds this work plus where to watch, sequel and new-season alerts, stats with a Sunday recap and a yearly goal, a watch diary, and "what's good this season". Friends beta moves to 6 (with friend features) and distillation to 7. Manga stays deferred.
**Alternatives:** Keeping Chat as the only way to change the list. Putting the features into Milestone 4. Building friend features now.
**Why:** You pointed out that read-only editing was a v1 scope choice, not a rule, and that onboarding from notes is a real need. The safety rule that matters, one logged and undoable write path, still holds. Milestone 4's done-when was met, so this is a new milestone rather than scope creep.
**Consequences:**
- The proposal sources gain `user` and `import`.
- Import needs its own eval with your cases.
- Every milestone after 4 is renumbered in CLAUDE.md and the design doc.

## 2026-10-07 — Import: the model only reads, code matches and groups, writes run in-process (Milestone 5)
**Decision:**
- **Reading:** Flash-Lite (prompt `import.v1`) reads about 25 lines per call and reports each show with one tool, `report_items`: your words for it, the title exactly as written, and only the status, episodes, score or rewatching the line gives. A line it skips still becomes a row ("Couldn't read this line"), so nothing in the notes goes unseen.
- **Matching:** code matches each title on your list, then on AniList (3 titles per request). A match is clear only when that line's own words name the show, the grounding rule from #65.
- **Grouping:** `groupMatched` applies your rules:
  - **add** (pre-checked; a score with no status means Completed);
  - **update** (pre-checked; forward only: more episodes, starting or finishing a planned show, finishing or resuming one in progress, a score where MAL has none);
  - **disagree** (lower progress, a change to a finished show, a contradicting status or score; keeps MAL unless you tap);
  - **already up to date**, **which one?**, **couldn't find**.
- **Writing:** an in-process background job writes the checked rows through `commitProposal` (`source: "import"`, idempotency key per row), about one a second. Your Import tap is the confirmation, adds included. It resumes after a restart.
  - A row whose entry changed since your review (a sync, an edit) isn't written ("changed since review").
  - Undo reverses the written rows newest first, refusing entries changed since, as History does.

**Alternatives:**
- Letting the model match and decide (its guesses would be pre-checked writes).
- pg-boss jobs (more moving parts; a restart resume does the same here).
- Writing rows as fast as possible (MAL's limits are undocumented).

**Why:** The one thing that must never happen is a wrong pre-checked row, so everything that decides a write is in code and tested. The model only turns messy notes into structured lines.

**Consequences:**
- A 100-line paste of shows not on your list takes about a minute to match (AniList is spaced 3 s apart) and about 2 minutes to write.
- Reading is a paid model call, so an interrupted read is marked failed rather than redone.
- The import eval (next) measures wrong pre-checked rows.

## 2026-10-07 — Import eval, and a clear import match needs the title's words in the show's name (Milestone 5)
**Decision:**
- **The eval:** `pnpm eval:import` runs import cases (`eval/cases/import-*.yaml`: the notes, plus the expected group, show and change fields per row) through the app's own `prepareImport`, against a list snapshot or an empty one, with AniList frozen. Its first metric is **wrong pre-checked rows**: rows one Import tap would have written wrongly.
- **The fix it found:** in import, a match is clear only if every word of the title as written (season words aside) is in the matched show's name, as well as passing the search's clear-match rule.

**Alternatives:** Raising the fuzzy threshold for everything, which hurts nicknames in Chat. Asking for every non-exact match, which would mean many more taps.

**Why:** The first eval run caught "perfect blue 10/10" pre-checked as a score of 10 for Blue Period, which is on the list and Perfect Blue isn't. Its word similarity, 0.615, passes the 0.6 bar for a clear match. Notes, unlike Chat messages, are full of shows that aren't on the list, so a lone fuzzy match there isn't evidence. Nicknames that are part of a name ("frieren", "kusuriya") still pass.

**Consequences:**
- A typo or a different spelling becomes a "?" row instead of a match.
- Chat's search has the same loose match. That's tracked as a separate task, since changing it needs the full update eval.

## 2026-10-07 — A clear match needs your words in the show's name, in Chat too (Milestone 5)
**Decision:** This extends "Import eval, and a clear import match needs the title's words in the show's name" to every search, and refines "A clear match must be grounded in your words".
- **One rule in search.** The clear-match rule (`markClear`) now also needs every word of the query, season words aside, in one name of the show, or of another season of it ("jjk s2" reaches season 2 through season 1's "JJK"). It holds for your own words too, so it covers Chat's `search_my_list`, `search_anime` and import alike.
- **What counts as a word of the name:**
  - one of its words;
  - a few of its words run together ("rezero" for "Re:Zero", "jojos" for "JoJo's");
  - a close spelling of one of its words: trigram similarity 0.45 or more. "Gangster" for Gangsta. is 0.55 and "kabeneri" for Kabaneri is 0.50, but "perfect" for "period" is 0.25 and "hoyuka" for Hyouka is 0.27.
- **Import uses the same `wordsInName`,** now in `src/list/grounding.ts`. A close spelling in your notes is therefore pre-checked too. This reverses the earlier consequence that a typo in notes becomes a "?" row (your call).
- No prompt change.

**Alternatives:**
- Guarding only Chat's tool layer.
- Strict words, where every typo asks. You chose this first, but the replay below showed it turned two of your labeled write cases ("Finally picked up Gangster", "kabeneri") into questions.
- Checking only the name that matched best, as import did.

**Why:**
- "perfect blue" scores 0.615 against Blue Period and nothing else comes close, so it was a unique clear match. #65's grounding rule doesn't check your own words.
- A scripted Chat run of "finished perfect blue 10/10" (Perfect Blue isn't on the list) committed a score of 10 to Blue Period.
- Live on Flash-Lite (15 runs of three wordings), search marked Blue Period clear every time. The model happened to search AniList and offer to add Perfect Blue instead, but nothing in code stopped the write.

**Consequences:**
- **Free replay** of the 536 searches recorded in the last 3 full Flash-Lite runs. The only clear matches the rule removes:
  - Blue Period for "perfect blue" (all 3 runs).
  - Kaiji: Ultimate Survivor in the "started ping ping" case. Its synonym "The Suffering Pariah Kaiji" scored 0.6 there (all 3 runs; never written).
  - Zetsuen no Tempest for "blast of the tempest", because of the extra "the". That case expects no write.
- **The live probe after the fix:** Blue Period was never clear (0 of 15 runs, down from 15 of 15), and nothing was written to it.
- A word that's neither in the name nor spelled close to one makes the agent ask: a stray "the", or "hoyuka" for Hyouka.
- Live, on Flash-Lite with progress-sync v13, all 140 cases:

  | Run | Accuracy | Wrong writes | Clarification precision | Clarification recall |
  | --- | --- | --- | --- | --- |
  | before (#65's run and the 2 runs before it) | 133–136/140 | 0–1 | 67.5–74.3% | 96.3–100% |
  | **with this rule** | **131/140** | **0/121** | **69.2%** | **100%** |

  - Eight of the nine misses are asks from the earlier runs: bsd ep 5, omp 3, Mushoku Tensei, the newest TYBW s4 episode, the Cowboy Bebop rewatch, Hoyuka, the final mha season and Tenjiku arc.
  - The ninth is "clannad" answering "which one?". The model searched AniList only and proposed Plan to Watch, a no-op. It fails the same way with the old search code (4 of 4 reruns), so it isn't this rule.
  - A replay of this run's own searches found one more removed clear match: the model's "Bleach episode 380" had fuzzily matched a TYBW cour (0.636).

## 2026-10-08 — A reading that contradicts itself is never pre-checked; a null from the reader means not given (Milestone 5)
**Decision:**
- **Reading:** a `null` field in `report_items` means the line doesn't give it. zod's coerce had turned `episodes_watched: null` into 0 (`parse.ts`).
- **Your rule, wider:** a score with no status word means watched. A show not on the list, or on Plan to Watch on it, becomes Completed, pre-checked. An episode count of 0 next to the score is dropped.
- **Held:** these readings become a "?" row with only a note, and nothing writes them, not even "Use my notes":
  - a reading that would leave a show at Plan to Watch with the notes' score or episodes;
  - one that says finished short of the last episode: ep 0, or ep 3 of 12 when MAL knows the count.

**Alternatives:**
- A prompt change (import.v2) telling the model to leave fields out.
- Holding the score rows as "?" rows (you chose Completed).
- Offering a tap on the held rows.

**Why:** The import eval's wrong pre-checked row ("perfect blue 10/10" added as Plan to Watch with a score) didn't come from the model's status.
- In 30 captured reads, the model never said plan to watch. Once it sent `episodes_watched: null`, which became 0 and skipped the score rule.
- The same null made "finished bocchi the rock 9/10" a pre-checked Completed at 0 of 12.

Nulls are rare and random, so the fix is in code, and the guard catches any reading that says two things at once, however it arises.

**Consequences:**
- No prompt change: `import@1` stays.
- A Plan to Watch show on your list with a score in your notes now becomes Completed (it used to stay Plan to Watch with the score).
- "Finished X ep 3" of a 12-episode show is no longer pre-checked as Completed at 3 of 12.
- Held rows can't be imported from the review; they're fixed on the List screen.
- The import eval compares only the fields a case lists, so it didn't flag Completed at 0. Unit tests (a grid of readings and list states) now cover these rows.
- Chat's `propose_update` has the same coerce; that's a separate task.

## 2026-10-08 — A null tool argument means "not given" in propose_update (Milestone 5)
**Decision:** Every optional field of Chat's `propose_update` arguments reads `null` as not given: `status`, `episodes_watched`, `episodes_delta`, `score`, `is_rewatching` and `drop_reason`. A small `optionalArg` wrapper in `agent/tools.ts` maps `null` to `undefined` before the field's own check. The schema stays `.strict()`, and `anime_id` is still required. No prompt change.

**Alternatives:**
- Dropping null fields for every tool in the Gemini provider. That's one place, but the provider would then decide what a tool's arguments mean.
- Rejecting null, so the model retries. That costs a turn, and the error doesn't say which field was wrong.

**Why:**
- Flash-Lite sometimes sends `null` for a field it means to leave out. The import reader did it in about 1 of 20 reads of "perfect blue 10/10" (fixed in "A reading that contradicts itself is never pre-checked; a null from the reader means not given" above).
- `z.coerce.number()` reads `null` as 0, and in Chat a 0 is a real write:
  - A null score on a scored show clears the score. It commits at once when the message has any number in it ("watched ep 5 of frieren").
  - A null `episodes_watched` with "completed" on a show at 0 episodes completes it at 0 episodes, instead of filling in the total. That commits too.
  - On a show part-way through, the same null resets progress to 0. That is held (`progress_backwards`), but the Confirm card is wrong.
  - A null `episodes_delta` next to `episodes_watched` failed as `both_episode_forms`. A null `status`, `is_rewatching` or `drop_reason` failed validation. Both cost the model a retry.
- It hasn't happened in Chat yet:
  - 0 of 2,718 recorded `propose_update` calls in the saved eval reports (progress-sync v1–v13, every model) had a null.
  - The dev DB had no `propose_update` calls.
  - A replay of all 2,718 through the old and new schemas parsed every one the same.

**Consequences:**
- The model can't clear a field by sending null. An explicit `score: 0` still clears a score.
- The recommender's arguments (`recommend/agent.ts`) still use plain `z.coerce`. A null there becomes 0, which their `positive()`/`min(1900)` checks reject, so it fails loudly rather than writing anything.
- Live, on Flash-Lite with progress-sync v13, all 140 cases, run back to back:

  | Run | Accuracy | Wrong writes | Held adds right | Clarification precision | Clarification recall |
  | --- | --- | --- | --- | --- | --- |
  | before (main) | 131/140 | 0/121 | 5/5 | 69.2% | 100% |
  | **null as not given** | **129/140** | **0/119** | **5/5** | **62.8%** | **100%** |

  - Neither run sent a null.
  - The fix can't change what the model sees: the tool specs it gets are unchanged, and the schema only runs once it calls `propose_update`.
  - The two cases that flipped never reached `propose_update`, so they are model noise. "Starting future diary and odd taxi" searched Odd Taxi until the repeat stop; it also failed once on 2026-10-06. "two episodes of kabeneri … and 5 eps of kabeneri" asked instead.
  - Reruns of the two, 3 each on this fix: kabeneri 3/3, future diary 2/3. The miss again never called `propose_update`: it searched only AniList and said Future Diary was already on the list.

## 2026-10-08 — Import cases written by Claude at Cyril's request; "bsd 4" and "tatami galaxy" match (Milestone 5)
**Decision:**
- **The cases:** Cyril waived CLAUDE.md's "you write the eval cases" rule for import cases only. The reason given: notes aren't open-ended enough to need hand-written wording. Claude wrote 14 cases (`import-notes.yaml`, `import-onboarding.yaml`). Each expected row comes from Cyril's import rules and the snapshot's state, not from what the app produced. A failing row was judged against those rules: the case or the app. The rule still holds for every other kind of eval case.
- **Seasons:** when a title ends in a bare number ("bsd 4") and the show the rest of it names doesn't carry that number, import looks for that season of the same show on the list by its own names ("Bungou Stray Dogs 4th Season"). If none is named exactly, the user picks.
- **Leading articles:** when nothing is clear, a title that is a show's name minus a leading "The" ("tatami galaxy") picks that show, but only if every other candidate is its movie, special or OVA. Seasons still ask.

**Alternatives:**
- Treating these rows as fine because they're safe: "bsd 4" was a "?" row on the wrong show, and "Use my notes" would have dropped season 1.
- Changing the shared list search, which would need the full update eval.

**Why:**
- The first run of the cases: 51/55 rows right, 0 wrong pre-checked.
- Two misses were app weaknesses ("bsd 4" matched season 1 by its "BSD" synonym; "tatami galaxy" asked between the series and its Specials). One was the model adding a status that wasn't on the line ("uzumaki 7/10"), caught as a "?" row.

**Consequences:**
- Two runs after the fixes: 55/55 and 54/55 rows right (the Uzumaki misread), 0 wrong pre-checked of 29–30.
- Both fixes live in import only; Chat's search is unchanged.

## 2026-10-08 — Where to watch: AniList links already cached, on cards for your services (Milestone 5)
**Decision:**
- **Data:** a list show's streaming links are its `anilist_media` row, the same AniList data the brief uses. After a sync, the shows the recommender can pick (Plan to Watch, Watching, On hold, rewatches) are refetched when their row is over a week old. A pool show's links come with the discovery build, in a new `anilist_catalog.streaming_links` column (migration 0019).
- **Recommender:** `find_candidates` takes `services` ("on Netflix" → `["netflix"]`) or `on_my_services` (the Brief page's services). It keeps only shows AniList lists on one of them, and never loosens it. Each candidate says where it streams among the user's services and the ones asked for (`streams_on`). Services filter only; they never change the ranking.
- **Cards:** a pick card names the user's services, plus any the request asked for, that AniList lists the show on. Each name links to AniList's https link for that service. A show AniList lists nowhere they have gets nothing, as the brief does.
- **Eval:** a case's `services` (the user's, for that case) and an `expect.streams_on` label, checked against `snapshots/streaming.json`. That file is AniList's links for the snapshot's pickable shows and the pool's, frozen once with `pnpm eval:streaming`.

**Alternatives:**
- A new `anime_streaming` table refreshed weekly (the plan). It would duplicate the links `anilist_media` already holds, from the same AniList query.
- Ranking shows on the user's services higher when they didn't ask. That's not something they asked for, and it would change every recommendation's ranking.
- Naming every service AniList lists. The design says to name only the user's services.
- Adding the links to `details.json` with an `eval:recommend-data` flag (the plan). That file is MAL's data from the dev database, while these links are AniList's, fetched live, so they get their own file like `airing.json`.

**Why:** the links, their site-id mapping (`brief/services.ts`) and the refresh path already existed for the brief. Filtering without reranking keeps "where to watch" out of every other request.

**Consequences:**
- Right after a first sync, links arrive with the background refresh (seconds). Until then, a services search finds only pool shows.
- A service AniList doesn't map to one the app knows (iQIYI, Hoopla) can't be checked. The recommender says so instead of guessing.
- Links can be up to a week old, or older if the user doesn't sync. Licenses change slowly, and the brief refreshes Watching shows every 6 hours anyway.

## 2026-10-08 — recommend.v7 for where to watch; progress-sync.v14 tried and not made current (Milestone 5)
**Decision:**
- **recommend.v7 becomes current.** It maps "on Netflix" to `services` (the service ids are listed in the prompt) and "on my services" to `on_my_services`. It never loosens the services. For a service the app can't check, it says which ones it can. The pick's line doesn't repeat where the show streams, since the card shows it.
- **progress-sync stays at v13.** v14 added one sentence: asking what's good on a streaming service is asking what to watch, so it goes to `recommend_shows`. It fixed the handoff but cost ordinary updates, so it isn't current.

**Alternatives:**
- Keeping recommend.v6. The tool's own schema got v6 through both format examples (2/2), but v6 has no rule for a service the app can't check, and none against loosening the service.
- Making v14 current for the handoff. On v13, "any movies on netflix" never reached the recommender (0/2). The progress agent answered it itself ("I don't have access to Netflix catalogs"). v14 handed it off 3/3, with 12/12 across four phrasings.
- An example-only version (v15, not in this PR). It adds "any movies on Netflix?" to the examples of asking what to watch, with no new sentence. It's untested, because the Gemini prepaid credits ran out mid-check.

**Why:**
- v14 on the full update eval (Flash-Lite, 140 cases): one run got 130/140 with 1 wrong write (1/124). "I haven't finished made in abyss yet" became +1 episode, which completed the show. That case had passed all 22 earlier runs, v4–v13.
- Side by side, the same day: v13 got 131/140, 0/121 wrong writes; v14 got 129/140, 0/120.
- Across v14's three full runs, cases v13 passes in all five of its runs failed:

  | Case | v13 | v14 |
  | --- | --- | --- |
  | "gonna start clannad" | 0/5 failed | 3/3 failed |
  | "culling game" | 0/5 | 2/3 |
  | "Just watched MHA more" | 0/5 | 2/3 |
  | "Watched Wistoria Season 2 episode 12" | 0/5 | 1/3 |
  | "I haven't finished made in abyss yet" | 0/5 | 1/3 (the wrong write) |

  One sentence about streaming shifted how Flash-Lite reads ordinary updates. No wrong write is worth a smoother handoff.

**Consequences:**
- Recommendation eval, recommend.v7 behind progress-sync.v13, every case (Cyril's 25 plus 7 format examples, 2 of them new for streaming): 32/32. 92/92 picks within the labels, genre fit 97%, median 4.5 s, $0.006 a case.
- "Anything good on netflix?", "what should i watch on crunchyroll" and "something on hulu tonight" reach the recommender on v13 (7/7, in throwaway probes and the format example). "Any movies on netflix" doesn't (0/2), and "anything good on iqiyi?" reaches it 1/4 of the time. Both get a safe reply, with no guess and no write.
- Next, once the credits are topped up: test v15 the same way. First the five cases above ×3 and the probes, then a full run side by side with v13.
- `pnpm eval:recommend --agent-prompt progress-sync@N` runs the recommendation cases behind another progress prompt.

## 2026-10-08 — progress-sync.v15: "gonna start X" on the list is episode 1; "any movies on Netflix?" is asking what to watch (Milestone 5)
**Decision:** progress-sync.v15 becomes current, with two changes from v13:
- **"Gonna start X":** "going to start X" and "gonna start X" mean Plan to Watch only when `on_your_list` is null, so the show isn't on the list. For a show on the list, Plan to Watch included, they mean episode 1, like "started X". Another session diagnosed this; Cyril approved the wording.
- **Streaming questions:** "any movies on Netflix?" joins the examples of asking what to watch. It's one more example in the existing list, not a sentence of its own as in v14 (see "recommend.v7 for where to watch; progress-sync.v14 tried and not made current" above).

**Alternatives:**
- **Reword only the note on `search_anime` results.** That's a prompt change in effect, but `--prompt` can't compare it against v13.
- **Reinterpret "gonna start" in `propose_update`.** That would let the server decide a write, which an earlier decision ruled out.
- **Ship the two changes as separate versions.** That costs a second round of evals. Both went into one version, with the plan to split them if the full run regressed. It didn't.

**Why:**
- **"Gonna start X":** v13 has two lines that clash on the same phrase, and the model dropped the "isn't on their list" condition. After "gonna start clannad", "clannad" proposed Plan to Watch for a show already there: 1/10 right on v13, 6/6 on v12. That failure is safe (nothing is written), but it's wrong.
- **Streaming questions:** on v13, "any movies on netflix" was answered by the progress agent itself ("I don't have access to Netflix catalogs") 2 of 2 times.

**Consequences:**
- **Targeted checks (Flash-Lite):**
  - The Clannad follow-up: 10/10 right.
  - The five cases v14 broke, 3 runs each: Wistoria, MHA and Made in Abyss 3/3 each, "gonna start clannad" 2/3, "culling game" 1/3. 0 wrong writes.
  - Those last two run side by side, 6 runs each: v13 got 5/6 and 4/6, v15 got 4/6 and 5/6. Both cases are flaky on v13 too now. Their misses are asks, not writes.
  - Streaming probes behind v15: "any movies on netflix" 3/3 reach the recommender (0/2 on v13), "anything good on netflix?" 3/3, and "anything good on iqiyi?" 3/3 (1/4 on v13).
- **Full update eval, all 140 cases on Flash-Lite, side by side:**

  | Prompt | Right | Wrong writes | Clarification precision | Clarification recall |
  | --- | --- | --- | --- | --- |
  | v13 | 129/140 | 0/120 | 62.8% | 100% |
  | **v15** | **131/140** | **0/123** | **70.3%** | **96.3%** |

  All of v15's 9 misses are cases that also fail on v13 runs ("omp 3", Mushoku Tensei, TYBW s4's newest episode, Cowboy Bebop again, Hoyuka, Future Diary and Odd Taxi, the final MHA season, "gonna start clannad", Tenjiku arc). Each misses by asking or doing nothing; none writes anything wrong. The Clannad follow-up and "culling game" passed.
- Cost: about $1.35 of evals in all for this version.
- **Next:** the diary's prompt change (PR 6) builds on v15.

## 2026-10-08 — The brief says when a sequel or a Plan to Watch show starts airing (Milestone 5)
**Decision:**
- **What counts:** a show whose first episode aired in the brief's window. That's either a Plan to Watch show MAL says is airing or about to, or a sequel to a show the user completed. A sequel comes from AniList's SEQUEL relations, must be a TV, TV short or ONA series, and must not be on the list in any status.
  - The same `airedBetween` request that finds new episodes finds the premieres.
  - For list shows, "first episode" is MAL's ep 1, so a later part of a show AniList splits isn't a premiere.
- **Sequel data:** relations are cached a week in a shared `anilist_sequels` table, keyed by the earlier show's MAL id (migration 0020). A sync and the brief refresh it. If the refresh fails, the brief uses the cached relations and still sends the episodes.
- **The brief:**
  - Premieres are stored in `briefs.alerts`, apart from `items`, so "watched it" still covers only the episodes.
  - In Chat they come after the reply hint, under "Started airing:".
  - A day with only premieres is sent, with a template line and no model call.
  - The push names them.
  - Each premiere gets a show card. A sequel that isn't on the list has an Add button, which sends "Add X to my Plan to Watch" to Chat. Chat then asks to confirm, as every add does.
- **The Brief page:** its responses (`/brief/test`, `lastDaily`) gain a `started` count, and the page's wording covers premieres.

**Alternatives:**
- **A `season_alerts` table with a sent flag (the plan), and a `sequel_announced` kind.**
  - Briefs' windows don't overlap, so a premiere lands in exactly one brief, as an episode does. A sent flag would be a second record of the same thing.
  - Announcements were left out, because the done-when asks about starting to air.
- **Detecting a premiere from AniList's start date or a status change.** `airedBetween` is what the brief already trusts for episodes, and ep 1 in the window is exact.
- **Movie and special sequels.** They have no airing schedule to say when they come out, so they're left out for now.
- **Having the model write the line for a premieres-only day.** That's a prompt change, which needs an eval round. The template is enough for one or two shows.

**Why:** it reuses what the brief already has: the window, the airing request, the services and the show cards. Premieres stay apart from the episodes the brief-reply rules depend on.

**Consequences:**
- A premiere is missed when no brief covered its time, as an episode is: the brief was off, or the 48-hour cap. Test briefs (the last 24 hours) can repeat one, as they repeat episodes.
- Only completed shows' sequels count, not those of dropped or on-hold shows.
- The relations cost about one AniList request per 50 completed shows a week. The query was tried against AniList with 50 shows per page.

## 2026-10-08 — Stats, MAL-site changes and the yearly goal (Milestone 5)
**Decision:**
- **MAL-site changes:** a sync after the first one compares MAL's list with the mirror before replacing it, and records what changed in `list_events` (migration 0021):
  - shows added;
  - the list fields changed on the others (status, episodes, score, rewatching; not dates);
  - shows removed.

  A change counts only when MAL's time for it is newer than the mirror's, and a removal only for an entry the mirror had before the sync began. That way a kurisu write landing mid-sync isn't mistaken for a change on MAL. kurisu's own writes stay in `changes` and leave nothing for a sync to find, because a commit writes MAL's answer, `updated_at` included, into the mirror.
- **Stats (`GET /stats`, `/list/stats`):**
  - **All time:** days watched, episodes, completed, mean score, the score spread, statuses and the most completed genres.
  - **This year:** shows completed, by month, with the latest ones.
  - **The last 7 days:** episodes, hours, shows and shows finished.
- **What the last 7 days count:**
  - **Episodes:** episodes moved forward, through kurisu or on MAL. A show added through kurisu counts its episodes (the user said they watched them). A show added on MAL counts them only while it's Watching, since one added as completed is usually an old show being logged.
  - **Left out:** undos, undone changes and imports.
- **This year's completions:** counted by MAL's finish date, or else by the day kurisu or a sync saw the show completed.
  - kurisu doesn't send MAL a finish date, so MAL's date alone would miss every show finished through kurisu.
  - An old show logged as completed has neither date, so it doesn't count.
  - "This year" follows the user's time zone, from the brief settings.
- **The goal:** `yearly_goals` (user, year, target), set on the Stats page with `PUT /stats/goal`. The page shows a meter.
- **The Sunday recap moves to a PR of its own (5b).** It reads the same last-7-days numbers.

**Alternatives:**
- **Writing a finish date to MAL when kurisu completes a show.** That's a new kind of write the user never asked for. The local fallback answers the goal without touching MAL.
- **Recording every sync difference, the first sync included.** The first sync would log the whole list as "added".
- **A daily snapshot of the list, diffed later.** It's more storage, and the sync already holds both sides of the diff.

**Why:**
- The diff needs no extra MAL calls, and it can't count kurisu's own writes twice.
- The completion fallback keeps "using MAL finish dates" (Cyril's choice) true wherever MAL has one.

**Consequences:**
- A MAL-site change is only seen at the next sync (login, Re-sync, or after a kurisu write). The page says so.
- Several edits on MAL between two syncs show as one net change.
- A sync that read MAL before a kurisu write still overwrites the mirror with the older copy until the next sync. That was already true, and now no event is recorded for it.

## 2026-10-08 — The Sunday recap (Milestone 5)
**Decision:**
- **When:** a brief whose local date is a Sunday also sums up the last 7 days, up to the brief, and the year. A daily brief uses its own date; "Send a brief now" uses today's. The `sunday_recap` setting (migration 0022, on by default) turns it off from the Brief page.
- **What it says:** one paragraph. For example: "This week: 23 episodes (9.2 hours) across 4 shows. Finished Bocchi the Rock! and Frieren. 2026 goal: 18 of 40 shows." Without a goal, the last sentence is the count: "18 shows completed in 2026."
- **The numbers:** the same ones as the Stats page's last 7 days and this year (`stats/compute.ts`). The recap is stored in `briefs.recap`, so a retried push uses the same numbers.
- **Where it goes:**
  - On a Sunday with new episodes or premieres, it ends the brief, after the reply hint, and the push stays about the episodes.
  - On a Sunday with nothing else, the brief is sent with the recap as its line and the push "Your week: N episodes". No model call is made.
  - A week with nothing watched or finished has no recap, so a quiet Sunday sends nothing.

**Alternatives:**
- **A separate weekly push at its own time.** That's a second schedule to manage, and the plan put the recap inside the brief.
- **A model-written recap.** That's a prompt change and an eval round, for a sentence the numbers fully determine.
- **The calendar week (Monday to Sunday) instead of the last 7 days.** The brief goes out Sunday morning, so the calendar week would leave out Sunday itself, or count the brief before its day is over. The last 7 days match the Stats page.

**Why:** it reuses the brief's scheduling, delivery and settings, and the Stats page's numbers, so the two always agree.

**Consequences:**
- A user whose brief is off gets no recap. The Stats page has the same numbers.
- Brief responses gain `recap` (the test response and `lastDaily`), so the Brief page can say "Sent your week's recap".


## 2026-10-08 — The diary reads reactions apart from the write agent; progress-sync.v16 not kept (Milestone 5)
**Decision:**
- **The reader:** a reaction ("that finale was insane") is read by a diary reader of its own (`src/diary/reader.ts`, prompt `diary.v1`, the agent role's model).
  - It runs in the background after a Chat message's updates commit.
  - It sees only the message and the shows it updated, and calls `save_reactions` with an anime_id and the user's words for each.
- **Own words only:** code keeps the words only if they appear in the message word for word (case and spacing aside), and otherwise the whole message. Notes go in `diary_notes`, one per change, for shows that message updated (migration 0023). An undo takes a note back, as it does a drop reason.
- **The write agent stays as it was:** progress-sync.v15 remains current, and the write agent never sees the diary.
- **The page:** `/list/diary` (`GET /diary`, `DELETE /diary/notes/:id`) shows the latest 100 updates by day in the user's time zone: kurisu's, minus imports, undos and undone changes, plus MAL-site changes. Each comes with its note, which can be deleted.
- **Eval:** `pnpm eval:diary` runs only the reader over the update cases' messages, with each case's expected writes as the shows updated. An optional `expect.reaction` label is shown in one format example.

**Alternatives:**
- **A `reaction` field on `propose_update` (progress-sync.v16).** It was offered only to prompts that opt in, with v15's system text unchanged.
  - It passed its format examples 3/3, saving exactly "that fight scene was insane".
  - Side by side on all 141 cases, though: v15 got 130/141 with 0/122 wrong writes, and v16 got 128/141 with **2/123 wrong writes**. "Watched 4 more episoddes of charlotte" also set Watching, and "…resuming servamp" also set episode 4. Neither case had a wrong write in any of their 14+ earlier full runs.
  - One optional field shifted how Flash-Lite fills in the fields it does use. So v16 was never committed.
- **Saving the whole message every time (the plan).** A message about several shows would file all of it under each one.
- **A note without an update** ("frieren is so good"). There's no change to attach it to, so it's left out for now.

**Why:**
- No wrong write is worth a diary feature. A separate reader can't change a write at all, and it can be evaluated on its own for a few cents instead of the 140-case update eval.
- Checking the words against the message keeps the notes the user's own.

**Consequences:**
- `pnpm eval:diary` on Flash-Lite with diary.v1, run twice, over 97 messages with writes:
  - The labeled example was right both times.
  - Each run saved a note on 1 of 96 unlabeled messages: "didnt like", on a message that drops a show for that reason.
  - Median 0.5 s, about $0.00015 a message.
- A reaction costs one extra small model call per message that commits something, and the reply doesn't wait for it.
- A change confirmed later with a tap, rather than in its message, gets no note.
- Integration tests turn the diary off (`diary: false` in the harness), since it would take the agent model's scripted turns. The diary's own tests turn it on.

## 2026-10-08 — What's good this season; recommend.v8 (Milestone 5)
**Decision:**
- **The lineup:** a shared `season_shows` table (migration 0024) holds what's airing now: this season's series and last season's still airing (TV, TV short, ONA), most popular first, from AniList. Only shows on MAL that have started airing and aren't adult are kept, with their details in `anilist_catalog`. It's rebuilt at most daily after a sync, just before discovery.
- **The search:** `find_candidates` gains `airing_now`. It then searches only airing shows: the user's own, plus season shows that aren't on their list and don't follow a show they haven't completed.
  - A season show's pull follows its popularity rank, and its facts say "#N most popular show airing now".
  - Other requests never see season shows.
- **recommend.v8:** v7 plus one line mapping "this season", "airing now", "currently airing", "what's good right now", "seasonal anime" and "new this season" to `airing_now`. It's current.
- **Eval:** `snapshots/season.json` (`pnpm eval:season`, 54 shows for 2026 FALL) and an `airing_now` label. One format example. Cyril's own cases are a YOUR TURN.

**Alternatives:**
- **Adding season shows to each user's discovery pool (the plan).** The lineup is the same for everyone, while the pool is per user and rebuilt with taste weights and a size cap. The pool would drop or reweight them, and they'd show up in every "something new" request.
- **Every currently airing show by popularity.** Long-running shows (One Piece) would crowd out the season's lineup. Last season's still-airing shows cover the two-cour ones.

**Why:** it reuses the catalog, ranking, cards and where-to-watch that discovery already has. Gating on `airing_now` keeps the other 25 recommendation cases' behavior as it was.

**Consequences:**
- Recommendation eval on v8, every case (Cyril's 25 plus 8 format examples): 33/33, 95/95 picks within the labels, median 3.8 s, $0.006 a case.
- Throwaway probes (5 phrasings ×2, not committed): every one that reached the recommender was right. "What's new this season" stayed with the progress agent once in 2 (progress-sync.v15), the same handoff gap as "any new anime?".
- The user's own airing shows rank first (the list boost), so "what's good this season" leads with what they're watching. New shows fill in after.
- Season shows are fetched once a day for every user together: one lineup request plus a details request per 50 shows.

## 2026-10-08 — "This season" questions reach the recommender: progress-sync.v17 and recommend.v9 (Milestone 5)
**Decision:**
- **Cyril's cases:** 8 "this season" cases, in their own words, in `recommend-season.yaml`. Each is labeled by the scenario it answers (airing now, plus Netflix, funny, no isekai, new to them, or their own Watching list).
- **progress-sync.v17 (from v15; v16 was never committed):**
  - Three examples join the existing "what to watch" line: "what's new this season?", "what's airing on Netflix?" and "what am I watching that's airing?".
  - The line for questions adds that `search_my_list` only finds titles. The agent must never say the list has no shows of some kind, and points whole-list questions to the List screen.
- **recommend.v9 (from v8):**
  - "New" in a message that also asks what's airing means new to the user (`from ["new"]`). Cyril: "new" means new to them almost every time.
  - "What am I watching" means their Watching list, queued shows included.
- Both are current.

**Alternatives:**
- **Keep v15 and v8 and accept the misses.** On v15, 3 of the 8 cases never reached the recommender. One of them, "what am i watching thats airing rn", got a false answer: the agent searched the list for the word "airing", found nothing, and said "You don't have any shows currently airing."
- **A sentence of its own for airing questions.** v14 did that for streaming questions, and it cost ordinary updates. Examples in existing lines cost nothing measurable here.
- **"New" always means new to them, even alone ("any new anime?").** That reverses Cyril's earlier rule to ask (recommend.v5). Changed only next to "airing", where "recently aired" is already covered.

**Why:** v15 and v8 got 4 of Cyril's 8 season cases right. v17 and v9 get all 8, with no cost to updates.

**Consequences:**
- **Recommendation eval, every case** (Cyril's 25 and 8 season cases, plus 8 format examples):
  - v15 + v8: 37/41.
  - v17 + v9: 41/41, 119/119 picks within the labels, median 4.4 s, $0.006 a case.
- **Update eval:**
  - v17: 132/141, 0/123 wrong writes, clarification precision 65.9% (recall 100%), median 2.4 s, $0.004 an update.
  - v15 the same day: 130/141, 0/121 wrong writes, precision 64.3%.
  - The same 8 known cases miss on both, and every miss asks instead of writing. Only v17 asked on "Just watched MHA more"; 3 that missed on v15 pass.
- "Any new anime?" on its own still asks which "new" they mean.


## 2026-10-08 — The kurisu design system, used as written: its stylesheet, dark only (between Milestones 5 and 6)
**Decision:**
- **The source:** the app takes its look from Cyril's design system "kurisu" on claude.ai.
- **What's copied:** `apps/web/design/` holds verbatim copies of its `tokens.json` and `bundle.css`. `bundle.css` loses only its Google Fonts `@import`, since `next/font` loads Outfit and JetBrains Mono instead.
- **Token variables:** `design/tokens.css` is generated from `tokens.json` (`design:tokens`).
- **How screens use it:** with the system's own `k-` classes (`k-btn`, `k-row`, `k-write`, ...). Tailwind does layout only, with the token colors mapped in (`bg-surface`, `text-ink-muted`).
- **Dark only:** there's no light theme. Until every screen is restyled, the old `dark:` classes always apply (`@custom-variant dark (&)`), so unconverted screens show their dark look on the new canvas.
- **The rollout:** four PRs.
  1. Foundation.
  2. Chat as a command log.
  3. The List screens.
  4. The other screens, then remove Tailwind's default palette.

**Alternatives:**
- **Re-creating every component in Tailwind utilities from the tokens.** That's twice the styling to maintain, and it would drift from the system's previews.
- **Keeping a light theme.** The system has none and says "Dark only".

**Why:** the system already ships its components as CSS on token variables. Using that file as-is keeps the app and the design system identical, and a newer version is a copy and one command.

**Consequences:**
- A newer version of the system is a file copy plus `design:tokens`, then a look at the screens.
- Off-system styles stay possible until the last PR removes Tailwind's default palette.
- The logo stays as `lib/brandMark.ts` draws it, as the system says, until final art replaces it.

## 2026-10-08 — Chat as a command log: every reply shows its run (between Milestones 5 and 6)
**Decision:**
- **The design:** Chat follows the design system's LogEntry. It has a time gutter, your lines on a band behind the crimson `›`, and replies in plain text with their artifacts below. The artifacts are WriteBlock (dashed teal, proposal ids, diff, Undo), held writes (Confirm or the add, and Cancel), ChoiceList, the PickCard panel and the BriefCard. Then come the collapsed trace and RunMeta.
- **API (`chatMessageViewSchema`):** each message gains `run`, which combines the reply's run, the run it escalated from and the recommender's run.
  - `run` holds the model, prompt versions, total latency and tokens, and an error code only when a run failed. Stop reasons like "handoff" are in the same column but aren't errors.
  - It also holds each tool call, with its arguments and result summed up in code (`chat/trace.ts`).
- **Brief messages:** a brief's message gains `brief` (items, premieres, recap), and chats gain `isBrief`.
- **Change views:** these gain the proposal id, poster and episode count for the write rows.
- **RunMeta shows no cost.**

**Alternatives:**
- **A separate endpoint for runs, fetched on tap.** The system says RunMeta is part of the reply and never behind a tap. One query per thread is cheap.
- **Showing cost.** Our per-run cost uses list prices, which overcount the real bill (decision of 2026-10-07). A wrong number is worse than none.
- **Raw tool arguments and results in the trace.** They're long, and results are truncated JSON. A few words each ("`"tidewater"` → 1 match") is what the system shows.

**Why:** the system's rule is "show the machine": every reply carries its run, and every write shows its id and can be undone. That data was already logged for evals (`agent_runs`, `agent_run_steps`), so this only exposes it.

**Consequences:**
- The thread query does two more lookups: runs with their steps, and briefs.
- The trace exposes tool names and arguments to the user. That's fine for a personal app, but it's worth a look before the friends beta (Milestone 6).

## 2026-10-08 — List screens in the design system, keeping List editing (between Milestones 5 and 6)
**Decision:**
- **The List screen:** ScreenHeader with a mono status line, section links as ghost buttons, StatusTabs with square marks and counts, FilterBar, and dense EntryRows. Each row has a progress-edged poster, a meter with its readout, and a mono score. Banners carry log levels (WARN, INFO, ERR).
- **History** uses the ChangeLog: day rows, the time in the gutter, the WriteBlock diff, and Undo.
- **The Diary** uses the same layout, with the user's words under each update ("said …").
- **The edit sheet** is a panel of the system's Field controls.
- **List editing stays.** The system's EntryRow note says "no inline editors; writes go through the log", but it was written before Milestone 5 added List editing, which Cyril asked for. So each row keeps "+1 ep" and Edit as small buttons. Every edit still goes through propose → commit, shows in History and can be undone.

**Alternatives:**
- **Dropping "+1 ep" and Edit, as the note says.** That would remove a Milestone 5 done-when ("I can edit any entry and remove shows on the List screen").

**Why:** the system describes the look. Cyril's milestone describes what the app does, and where they differ, the milestone wins.

**Consequences:** the design system's EntryRow should gain the two buttons and its note should change. That's for Cyril to decide in the artifact. `ChangeCards.tsx` is gone; History and Chat share the diff component.

## 2026-10-08 — The rest of the screens, and nothing off the system (between Milestones 5 and 6)
**Decision:**
- **Taste:** a hero metric, AffinityBars diverging from the centre line (teal up, crimson down, each with a sign), and drop reasons as DropReasons with posters. `dropReasonViewSchema` gains `pictureUrl`.
- **Stats:**
  - StatTile strips for the week, the year (hero) and all time.
  - The yearly goal as a crimson meter with its readout.
  - Months and scores as the system's ScoreHistogram, each with its table view. The score histogram is shown only from 10 scored shows on, as the system says.
- **Brief settings:** the system's switch, a mono time field and square checkboxes.
- **Import:** grouped panels, "?" tags, Keep MAL or Use my notes as pressed chips, "which one?" as a ChoiceList, the proposed write in teal, and a solid bottom bar with the primary Import.
- **Login:** the logo as it is, the `display` wordmark, and one `k-btn--lg`.
- **Lock-down:**
  - `globals.css` removes Tailwind's palette, radii, shadows and blur, and the always-dark shim.
  - `test/designSystem.test.ts` fails on a palette color, `dark:`, a radius past the system's, or a shadow, blur or gradient. A probe file proved it catches one.

**Alternatives:**
- **Keeping Tailwind's defaults and relying on review.** A stray class silently mixes in another palette. With the defaults removed, it renders nothing, and the test names the line.

**Why:** the system's rule: "If a value isn't a token, it doesn't belong in the UI."

**Consequences:**
- New UI can only use tokens (`bg-surface`, `text-ink-muted`, `rounded-control`) or `k-` classes.
- Layout utilities (flex, grid, spacing, sizing) still work.

## 2026-10-09 — Inter and Source Serif 4; monospace only for the machine (between Milestones 5 and 6)
**Decision:**
- **The design system's type is now v3:**
  - Inter for words and numbers. Every number uses tabular figures, so columns still line up.
  - Source Serif 4 for show titles, screen and section titles, the brief's summary and the wordmark.
  - JetBrains Mono only for what the agent prints: RunMeta, the tool trace and proposal ids.
- This replaces Outfit, and the rule that every number is monospace (the decision of 2026-10-08, "The kurisu design system, used as written").
- The artifact (version 8) and `apps/web/design/` changed together.

**Alternatives:** Cyril picked this pairing from four options, based on what the big trackers ship (read from their live pages on 2026-10-09):
- Geist + Geist Mono, which keeps monospace numbers.
- Barlow + Barlow Semi Condensed (Last.fm).
- Overpass + Overpass Mono (AniList).

**Why:**
- Cyril didn't like Outfit, or the mono labels like "airing".
- None of the trackers checked sets numbers in a monospace font. The polished ones pair a neutral grotesque for the interface with a serif for titles: Letterboxd (Graphik and Tiempos), MUBI (Riforma and Tiempos), and Hardcover (Inter and New Spirit). Inter and Source Serif 4 are the free fonts closest to that.

**Consequences:**
- Mono now means "the agent printed this", which the command log can lean on.
- The `.k-mono` and `.k-input--mono` class names stay for compatibility, though they're now Inter with tabular figures.
- Disclosure tables that borrow the trace's "[+]" toggle (Taste, Stats) set themselves back to Inter.

## 2026-10-09 — Hosting: a Compose stack on Cyril's PC, published by Tailscale Funnel (Milestone 6)
**Decision:** The hosted kurisu is one Docker Compose stack (`deploy/compose.yaml`, project `kurisu-prod`): Postgres with its own volume, the server, the web app, and a daily `pg_dump` kept 14 days. It runs on Cyril's PC. Tailscale Funnel publishes the web app at `https://<pc>.<tailnet>.ts.net`, and nothing else is reachable from outside.
- **Checkout:** the stack builds from its own checkout, detached at `origin/main` (`deploy/deploy.sh`), so dev edits never ship unmerged.
- **Separate from dev:** it has its own MAL app, token key, VAPID keys and database. Cyril's dev data was copied across once (`deploy/copy-dev-data.sh`), without tokens, sessions or push subscriptions.
- **Images:** keep the whole workspace, because the server imports `@kurisu/shared` as TypeScript source, which Node 24 runs from the workspace but not from `node_modules`. Migrations run when the server starts.
- **Proxy timeout:** Next's proxy waits up to 120 s, not 30, since a first login waits for a full list sync.

**Alternatives:**
- **A $5 VPS:** always on, but it costs money every month. Cyril wanted free for now.
- **Free tiers (Render, Railway, Vercel with Neon or Supabase):** they sleep when idle or expire databases. The server must run all day for the 5-minute brief check (decision of 2026-09-29).
- **Tailscale without Funnel:** private to the tailnet, so every friend would need Tailscale.
- **A Cloudflare Tunnel:** needs a domain.

**Why:** Free, HTTPS (which install and push need), and no account for friends to create. The stack is plain Compose, so a VPS later is the same files plus a restore.

**Consequences:**
- **Uptime follows the PC.** kurisu is down while the PC sleeps or is off.
- **The address is public.** Funnel hostnames show up in certificate logs, so sign-up must be closed (next entry).
- **Dev and hosted share Cyril's MAL list.** Writes from the dev app reach the hosted one as MAL-site changes.
- **PR #94 is closed.** Running the dev server over Tailscale is no longer the way to the phone.
- **Small changes from the plan:**
  - The scripts are bash (Git Bash here, any shell on a VPS), not PowerShell.
  - The database check is its own route, `/health/db`, so `/health` still needs no database.
  - `trustProxy` stays off. With Funnel and Next both in front, Fastify could only find the client's address from a header the client can forge, and only logs would use it.

## 2026-10-09 — Only the owner can sign up, until invites (Milestone 6)
**Decision:**
- **The setting:** `OWNER_MAL_USERNAME` names the MAL account that owns this kurisu. Production refuses to start without it.
- **While it's set:** a MAL login creates an account only for that username (compared case-insensitively). Anyone who already has an account still logs in. Everyone else is sent to `/?login_error=invite_only`, and the tokens MAL issued are dropped without being stored.
- **Production errors:** 500s say "Something went wrong", and the details go to the logs only.

**Alternatives:**
- An allowlist of usernames in the environment.
- Waiting for invites before the first deploy.

**Why:** The address is public from the first deploy, and an open sign-up would let anyone with a MAL account spend Gemini credit. Invites (the next PR) need an owner anyway.

**Consequences:**
- Unset (local development and tests), sign-up stays open as before.
- A MAL username change would stop matching, but only for creating an account. An existing account always logs in.

## 2026-10-09 — kurisu will be commercial: MAL is asked now, and a paid plan becomes Milestone 7 (Milestone 6)
**Decision:**
- **Commercial intent:** Cyril wants kurisu to charge, to pay for its model use. The friends beta stays free.
- **Asking MAL now:** Cyril sends MAL a note (drafted by Claude) through its support form. It asks two things:
  - whether keeping each user's list in kurisu's own database is fine under section 3(c) of the API agreement;
  - how to get the written approval section 3(a)(xiv) requires before a paid plan.

  The beta goes ahead while waiting. The hosted app's MAL registration says commercial, and its description says the beta is free.
- **Milestone 7 is now the paid plan.** That means the approvals (MAL's, and AniList's license past $150 a month), Stripe, a free tier and a paid tier, terms and a privacy policy, and likely a server. Distillation moves to Milestone 8, still a stretch.
- **Spending protection in Milestone 6:** a per-friend daily limit, plus a $5 monthly cap on friends' estimated model spend. The owner keeps working past the cap.
- **MAL sync stays as it is:** at login, after writes and on Re-sync. There's no polling, even for fresher friend activity.

**Alternatives:**
- Staying non-commercial, with one-off donations only. MAL allows donations without quotas.
- Inviting friends only after MAL answers.
- Putting the paid plan after distillation, or deciding only after the beta.
- Syncing when the app opens, to make friends' MAL-site changes show sooner.

**Why:**
- **Gemini isn't free for other people's data.** The beta runs on Cyril's prepaid credit, which stops every call, his own included, when it runs out.
- **Any revenue needs approval.** MAL counts any revenue (paid apps, subscriptions, even recurring donations with quotas) as commercial, which needs its written approval. AniList is free under $150 a month in revenue and needs a license above that, and it restricts competing list trackers unless it authorizes them.
- **Section 3(c)** says apps may not store MAL users' personal information or the content they create "on the server-side", and kurisu's list mirror (a hard rule since Milestone 1) does. It doesn't define those terms, but a revoked Client ID would break kurisu for everyone.
- **Why the paid plan comes before distillation:** the beta supplies real per-user costs to price from. A local model only saves money while kurisu runs on this PC; on a rented server it needs a GPU, which costs more than Flash-Lite.

**Consequences:**
- MAL's answer may change how the mirror works, and whether a paid plan is possible at all.
- **Price:** at list prices, a typical user costs about 50¢ a month in model calls. $2–3 a month, or about $20 a year (a card charge costs about 30¢), would cover it.
- CLAUDE.md and the design doc renumber distillation to Milestone 8.
