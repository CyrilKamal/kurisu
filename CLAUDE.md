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
- Eval cases: `pnpm eval:validate` checks every file in `apps/server/eval/cases/`, both YAML and one-line-per-case shorthand `.txt` files (CI runs it; `--verbose` shows each case's normalized expectation). The formats and rules are in `apps/server/eval/README.md`. `pnpm eval:lookup <words>` (or `--status watching`, `--airing not_yet_aired`) finds snapshot entries with their exact titles, MAL ids and progress. Never write or edit the user's real eval cases; only `examples.yaml` is ours.
- Eval catalog: `pnpm eval:catalog "<title>" ...` freezes AniList's answers to title searches into `eval/snapshots/catalog.json`, so cases about adding shows (`expect.adds`) have fixed answers. A title already frozen keeps its first answer.
- Eval snapshot: `pnpm eval:snapshot` re-exports the sanitized list snapshot from the dev DB. Don't re-export once cases depend on it. `varied-list.json` is a hand-made copy of it with 14 entries' states changed for wider coverage (listed in `apps/server/eval/README.md`); it's never re-exported. `airing.json` freezes AniList's newest aired episode per airing show (`pnpm eval:airing`, run once; it refuses to overwrite).
- Models: which model plays each role (agent, escalation, eval, brief, recommend), paid-tier prices and Ollama options live in `apps/server/config/models.json`; override a role with `AGENT_MODEL` / `AGENT_ESCALATION_MODEL` / `EVAL_MODEL` / `BRIEF_MODEL` / `RECOMMEND_MODEL`. `pnpm llm:smoke [--role agent|escalation|eval|brief|recommend] [--model provider:model]` checks a live tool-calling round trip. Evals need Ollama running locally (`ollama list` shows the pulled models).
- Web push: `pnpm --filter @kurisu/server push:keys` prints a VAPID key pair for `.env.local` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, plus `VAPID_SUBJECT=mailto:<email>`). Without them push is off. The server only sends to known browser push services (`src/push/send.ts`).
- Morning brief: a pg-boss queue (tables in the `pgboss` schema of the same database) runs inside the server and checks every 5 minutes for due briefs; `BRIEF_SCHEDULER=off` stops it. Settings are on the List screen under Brief (`/list/brief`), which also has "Send a brief now". Each brief starts its own chat, which the notification opens. Airing data comes from AniList (`src/anilist/`), cached 6 hours in `anilist_media`.
- Recommendations: the progress agent hands "what should I watch" messages to a recommendation agent (`src/recommend/`, prompt `recommend.v2`, the `recommend` role on Flash) through its `recommend_shows` tool. `find_candidates` ranks Plan to Watch and in-progress shows, plus shows new to the user from their discovery pool, in code; `present_picks` stores up to 3 checked picks (`recommendations` table) that Chat shows as cards. The discovery pool (`src/recommend/discovery.ts`: `anilist_catalog`, `discovery`, `discovery_runs`) is rebuilt from AniList in the background after a list sync, at most daily. Taste memory (`taste_genres`, `drop_reasons`) lives in `src/taste/`.
- Adding shows: prompts that list `search_anime` in their `tools` (v12 on) can find shows outside the list on AniList (`src/anilist/catalog.ts` stores provisional `anime` rows). Proposing a show that isn't on the list makes an add, which `propose.ts` always holds for the user's tap; undoing an add removes the show from MAL (`deleteListStatus`, still only reachable through `commit.ts`).
- Agent prompts live in `apps/server/src/agent/prompts/`. Any change to a prompt gets a new version (a new file, e.g. `progressSync.v2.ts`), because every agent run logs the prompt version and evals compare versions.
- Eval harness run: `pnpm eval` (Docker + Ollama). Filters: `--tag`, `--case`, `--file`, `--limit`; compare models with `--model provider:model` and prompts with `--prompt progress-sync@N`. Gemini runs are throttled (`--rpm`, default 60 calls a minute; the API key is on the paid tier, and a 90-case Flash-Lite run takes about 5 minutes and costs about $0.20). Reports update accuracy, wrong-write rate, clarification precision/recall, latency and cost, by tag, with every failure explained; JSON reports go to `apps/server/eval/results/` (gitignored).

Next.js 16 ships version-matched docs in `apps/web/node_modules/next/dist/docs/`; read them before writing web code (see `apps/web/AGENTS.md`).
