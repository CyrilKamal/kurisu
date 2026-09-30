# Anime Agent

A personal anime/manga agent: the user tells it what they watched or read in plain language, and it keeps their MyAnimeList (MAL) list in sync, sends a daily brief of new episodes, and recommends what to watch from their backlog. It ships as an installable web app (PWA).

**The source of truth is `docs/design.md`.** Read it before planning any milestone. If something you are about to do contradicts it, stop and ask rather than silently diverging.

## How we work

### One milestone at a time

The milestones are listed at the end of `docs/design.md`. Work on exactly one at a time.

1. At the start of a milestone, enter plan mode. Read the design doc and `docs/decisions.md`, then present a plan: what you will build, files you will touch, and any decisions that need my input.
2. Wait for my approval before writing code.
3. When you believe the milestone is done, check it against the "Done when" criteria below, run the tests, and give me a short summary of what was built and what is left.
4. Do not start the next milestone until I explicitly say so. Do not build "ahead" for future milestones, even small pieces.

If a task seems to need work from a later milestone, flag it and ask.

### Decision log

Keep `docs/decisions.md` up to date as you go. Add an entry whenever you choose between real alternatives: a library, a schema shape, an API approach, a prompt structure, a data source, an error-handling strategy. Skip trivial choices (variable names, formatting).

Append entries in this format, newest at the bottom:

```
## YYYY-MM-DD — <short title> (Milestone N)
**Decision:** what we chose.
**Alternatives:** what else was considered.
**Why:** the reason, in one to three sentences.
**Consequences:** what this makes easier or harder later.
```

Keep entries short. Write them at the time the decision is made, not in a batch at the end. If a later decision reverses an earlier one, add a new entry that references the old one; never edit or delete past entries.

### When it's my turn: stop and prompt me

Some work must be done by me, not you. When you reach one of these points, stop, and tell me clearly in a message starting with **"YOUR TURN:"** what I need to do and where. Then wait.

- **Eval test cases (Milestone 2).** Build the harness, the test-case schema, the fake MAL client, and at most 5 example cases that show the format. Then stop and prompt me to write the real test cases (target: about 150). Do NOT generate, label, or bulk-draft the real test cases yourself, even if asked to "speed things up" in a later session. You may list the coverage categories from the design doc as a checklist for me. Once I've written them, run the harness and report the metrics.
- **Real-world failures (Milestone 5).** When logged failures from real users appear, summarize them for me and prompt me to label the ones worth adding to the eval set. Don't label them yourself.
- **Accounts and secrets.** Registering the MAL API app, creating API keys, and anything involving a browser login or a paid plan. Tell me exactly what to create and which env var it goes in. Never ask me to paste a secret into chat.
- **Before Milestone 5.** Remind me to move off the Gemini free tier before anyone else's data touches the app, and wait for my confirmation.

## Stack

- **Frontend:** Next.js PWA (App Router), TypeScript. Two screens: Chat and List.
- **Agent backend:** TypeScript service. Holds MAL tokens, runs the agent loop, runs scheduled jobs.
- **Database:** Postgres.
- **Scheduler:** queue-backed daily cron for morning briefs.
- **Notifications:** Web Push.
- **Python:** only for Milestone 6 (fine-tuning). Keep it in its own `ml/` directory.

TypeScript runs in strict mode. Prefer small modules with clear boundaries over large files.

## Hard rules

These are non-negotiable. If a request conflicts with one, stop and ask.

**MAL writes**
- Nothing writes to MAL except `commit_update`, and `commit_update` only accepts a proposal ID produced by `propose_update`. The model never passes raw write arguments.
- Every proposal carries an idempotency key. A retried commit must never double-count progress.
- Every commit is recorded in the change log with the prior value, so it can be undone.
- Reads come from the local Postgres mirror, not live MAL calls. Sync with MAL on login and after writes only (MAL's rate limits are undocumented).

**MAL OAuth**
- MAL only supports the `plain` PKCE code-challenge method, not S256. Implement the flow by hand if a library can't do `plain`, and cover it with an integration test.
- OAuth tokens are encrypted at rest. Never log them.

**Models**
- Development uses free models only. No paid APIs without asking me first.
  - Gemini Flash-Lite (free tier): parsing and routine sync.
  - Gemini Flash (free tier, low daily quota): recommendations and ambiguous requests.
  - A local model via Ollama: eval harness runs.
- All model calls go through one provider interface module. No provider SDK is imported anywhere else. Swapping a model must be a config change.
- Model IDs live in config, not code. Check Google's current docs for the right model IDs rather than guessing.

**Data sources**
- Airing schedules come from AniList's public API, mapped to MAL entries by AniList's MAL ID field. Log and skip titles that don't map.
- Streaming availability: AniList external links, filtered to the services the user says they subscribe to. If there's no match, the brief says nothing about where to watch. Never guess. No TMDB in v1.
- Never scrape, link to, or surface unlicensed streaming or reading sites.

**Secrets**
- All secrets live in `.env.local` (gitignored). Keep `.env.example` current with every variable name and no values.
- Never commit secrets, tokens, or real user list data. Test fixtures use a sanitized snapshot.

**Observability (from Milestone 2)**
- Log every agent run: prompt version, model, tool calls with arguments, latency, token counts, and outcome.

## Milestones: done when

1. **MAL login, list mirror, List screen.** I can log in with MAL, my anime list is mirrored to Postgres, the List screen shows it, re-sync works, and the OAuth flow has an integration test.
2. **Progress-sync agent + eval harness.** Natural-language updates go through propose → commit. The harness runs against a fake MAL client using Ollama and reports update accuracy, wrong-write rate, clarification precision, median latency, and cost per update. My test cases are in and passing at a level we've discussed. Agent runs are logged.
3. **Morning brief.** A daily job builds each brief from AniList schedules and the user's Watching list, respects the user's streaming services, and sends a web push. Tapping it opens Chat.
4. **Recommendations + taste memory.** Recommendations draw from Plan to Watch and in-progress shows, respect constraints like runtime and mood, and explain each pick in one line. Taste memory records drop reasons and rating patterns.
5. **Friends beta.** A handful of invited users. Their failures flow into a review queue for me to label.
6. **Stretch: distillation.** Fine-tune a small open model (1–3B) on labeled update messages for the parsing step, serve it locally, and compare it with Flash-Lite on accuracy, latency, and cost. Log the results as a decision entry.

## Commands

Run from the repo root. Requires Node 24, pnpm 12 and Docker Desktop. Update this section whenever a command changes.

- Install: `pnpm install`
- Dev servers: `pnpm dev` (server on :4000, web on :3000; web proxies `/api/*` to the server)
- Local Postgres (reads `.env.local`): `pnpm db:up` / `pnpm db:down`
- Tests: `pnpm test` (all). Server only: `pnpm --filter @kurisu/server test:unit`, or `test:integration` (starts a Postgres container via Testcontainers; needs Docker running)
- Lint, typecheck, format: `pnpm lint`, `pnpm typecheck`, `pnpm format` (CI runs `pnpm format:check`)
- Build: `pnpm build`
- One package only: `pnpm --filter @kurisu/server <script>` or `pnpm --filter @kurisu/web <script>`
- Database migrations: apply with `pnpm db:migrate` (reads `DATABASE_URL` from `.env.local`). After changing `apps/server/src/db/schema.ts`, generate SQL with `pnpm db:generate --name <what_changed>` and commit the files in `apps/server/drizzle/`. Never edit an applied migration; add a new one.
- Click through the app without MAL credentials: `pnpm --filter @kurisu/server dev:fake-mal` starts a fake MAL on :4010 (auto-approved consent, synthetic list). Then run `pnpm dev` with `MAL_AUTH_BASE_URL=http://127.0.0.1:4010/v1/oauth2`, `MAL_API_BASE_URL=http://127.0.0.1:4010/v2`, `MAL_CLIENT_ID=fake-client-id` and `MAL_CLIENT_SECRET=fake-client-secret`.
- API contract: response schemas live in `packages/shared`. Change them together with the server, and add a contract test in `apps/server/test/integration/contract.test.ts` for any new endpoint.
- Eval harness: _Milestone 2_

Next.js 16 ships version-matched docs in `apps/web/node_modules/next/dist/docs/`; read them before writing web code (see `apps/web/AGENTS.md`).
