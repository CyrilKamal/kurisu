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
- **Real-world failures (Milestone 6).** When logged failures from real users appear, summarize them for me and prompt me to label the ones worth adding to the eval set. Don't label them yourself.
- **Accounts and secrets.** Registering the MAL API app, creating API keys, and anything involving a browser login or a paid plan. Tell me exactly what to create and which env var it goes in. Never ask me to paste a secret into chat.
- **Before Milestone 6.** Remind me to move off the Gemini free tier before anyone else's data touches the app, and wait for my confirmation. (Done: the API key is on the paid tier since 2026-10-05.)

## Stack

- **Frontend:** Next.js PWA (App Router), TypeScript. Four screens: Today, List, Chat and You.
- **Agent backend:** TypeScript service. Holds MAL tokens, runs the agent loop, runs scheduled jobs.
- **Database:** Postgres, with pgvector for Milestone 7's lab.
- **Scheduler:** queue-backed daily cron for morning briefs.
- **Notifications:** Web Push.
- **Python:** only for Milestone 7's fine-tuning experiment. Keep it in its own `ml/` directory.

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
5. **Your list, in your hands.** I can edit any entry and remove shows on the List screen, and every edit shows in History and can be undone. I can paste notes and import them through one review screen (grouped, adds and clear updates pre-checked, taps only on "?" rows, one Import tap, background writes with progress, one undo), from scratch or onto my MAL list, and my import eval cases pass at a level we've discussed with no wrong pre-checked rows. Picks show where to watch on my services, and "something on Netflix" works. The brief tells me when a sequel or new season of a show I finished, or a Plan to Watch show, starts airing. A Stats page and a Sunday recap show what I watched (including edits made on MAL's site), with a yearly goal. A diary keeps my reactions. "What's good this season" works.
6. **Friends beta.** A handful of invited users, plus friend features (taste match, activity). Their failures flow into a review queue for me to label.
7. **AI lab: embeddings, RAG and fine-tuning.** Four experiments. Each is measured against an eval and logged as a decision entry, whether or not it ships; nothing here has to reach the paid app.
   - **RAG over my history:** questions about my diary, drop reasons and chats are answered from retrieved notes, with citations. It's measured on retrieval recall@k and on whether answers stick to their sources, over a question set I write.
   - **Semantic recommendations:** show synopses embedded in pgvector, blended into ranking. It's measured on the recommendation eval.
   - **Hybrid title search:** vectors plus trigram matching. It's measured on update accuracy and wrong-write rate.
   - **Fine-tuning:** a LoRA fine-tune of a small open model (1–3B) on my labeled messages for the parsing step, served locally. It's compared with Flash-Lite on accuracy, latency and cost.
8. **Paid plan.** MAL has approved kurisu's commercial use in writing, and AniList's license is in place before revenue passes $150 a month. Anyone can sign up for a free tier with limits, or pay for a plan through Stripe. Terms and a privacy policy are published, and kurisu runs on a server that stays up.

## Commands

Run from the repo root. Requires Node 24, pnpm 12 and Docker Desktop. Update this section whenever a command changes.

- Install: `pnpm install`
- Dev servers: `pnpm dev` (server on :4000, web on :3000; web proxies `/api/*` to the server)
- Local Postgres (reads `.env.local`): `pnpm db:up` / `pnpm db:down`. The image is `pgvector/pgvector:pg18-trixie` (Postgres 18 with pgvector, the same Debian as `postgres:18`), pinned by digest in `docker-compose.yml`, `deploy/compose.yaml` and `apps/server/src/db/postgresImage.ts` (which the integration tests and the eval harness share); keep the three the same.
- Tests: `pnpm test` (all). Server only: `pnpm --filter @kurisu/server test:unit`, or `test:integration` (starts a Postgres container via Testcontainers; needs Docker running)
- Lint, typecheck, format: `pnpm lint`, `pnpm typecheck`, `pnpm format` (CI runs `pnpm format:check`)
- Build: `pnpm build`
- One package only: `pnpm --filter @kurisu/server <script>` or `pnpm --filter @kurisu/web <script>`
- Database migrations: apply with `pnpm db:migrate` (reads `DATABASE_URL` from `.env.local`). After changing `apps/server/src/db/schema.ts`, generate SQL with `pnpm db:generate --name <what_changed>` and commit the files in `apps/server/drizzle/`. Never edit an applied migration; add a new one.
- Click through the app without MAL credentials: `pnpm --filter @kurisu/server dev:fake-mal` starts a fake MAL on :4010 (auto-approved consent, synthetic list). Then run `pnpm dev` with `MAL_AUTH_BASE_URL=http://127.0.0.1:4010/v1/oauth2`, `MAL_API_BASE_URL=http://127.0.0.1:4010/v2`, `MAL_CLIENT_ID=fake-client-id` and `MAL_CLIENT_SECRET=fake-client-secret`. To log in as someone else (an invited friend), open `http://127.0.0.1:4010/fake/login-as?name=<name>&id=<number>` first; integration tests set `h.fakeMal.user`.
- API contract: response schemas live in `packages/shared`. Change them together with the server, and add a contract test in `apps/server/test/integration/contract.test.ts` for any new endpoint.
- Eval cases: `pnpm eval:validate` checks every file in `apps/server/eval/cases/`, both YAML and one-line-per-case shorthand `.txt` files (CI runs it; `--verbose` shows each case's normalized expectation). The formats and rules are in `apps/server/eval/README.md`. `pnpm eval:lookup <words>` (or `--status watching`, `--airing not_yet_aired`) finds snapshot entries with their exact titles, MAL ids and progress. Never write or edit the user's real eval cases; only `examples.yaml` is ours.
- Eval catalog: `pnpm eval:catalog "<title>" ...` freezes AniList's answers to title searches into `eval/snapshots/catalog.json`, so cases about adding shows (`expect.adds`) have fixed answers. A title already frozen keeps its first answer.
- Recommendation eval: `pnpm eval:recommend` runs `eval/cases/recommend-*.yaml` through the progress agent's handoff and the recommender. It checks each pick against the case's labels (kind of show, episode length, episodes left, genres, source, must-not, streaming services) and reports picks within the labels, genre fit, latency and cost (`--prompt recommend@N` compares prompts, `--agent-prompt progress-sync@N` the progress agent's, `--thinking <level>` thinking levels); about 1¢ a case on the paid tier. A case's `services` are the user's streaming services for it. It reads `snapshots/details.json` and `snapshots/discovery.json`, frozen once by `pnpm eval:recommend-data` (refuses to overwrite; `--fill-start-dates` only adds start dates to details.json), `snapshots/streaming.json`, AniList's streaming links for those shows, frozen once by `pnpm eval:streaming`, and `snapshots/season.json`, what was airing, frozen once by `pnpm eval:season` (both refuse to overwrite). `expect.airing_now: true` checks every pick is airing. Taste is neutral there, since the snapshot has no scores. The format is in `apps/server/eval/README.md`; only `recommend-examples.yaml` is ours.
- Import eval: `pnpm eval:import` runs `eval/cases/import-*.yaml` through the app's own import code (`prepareImport`): the model reads the notes, and code matches and groups each row against the snapshot (`empty` for onboarding) and the frozen catalog. It reports wrong pre-checked rows (must be 0), rows right, "?" precision and recall, latency and cost. The format is in `apps/server/eval/README.md`; only the `import-examples*.yaml` files are ours.
- Eval snapshot: `pnpm eval:snapshot` re-exports the sanitized list snapshot from the dev DB. Don't re-export once cases depend on it. `varied-list.json` is a hand-made copy of it with 14 entries' states changed for wider coverage (listed in `apps/server/eval/README.md`); it's never re-exported. `airing.json` freezes AniList's newest aired episode per airing show (`pnpm eval:airing`, run once; it refuses to overwrite).
- Models: which model plays each role (agent, escalation, eval, brief, recommend), a Gemini thinking level per role (`thinking`; the recommender runs on `low`), paid-tier prices and Ollama options live in `apps/server/config/models.json`; override a role with `AGENT_MODEL` / `AGENT_ESCALATION_MODEL` / `EVAL_MODEL` / `BRIEF_MODEL` / `RECOMMEND_MODEL`. `pnpm llm:smoke [--role agent|escalation|eval|brief|recommend] [--model provider:model]` checks a live tool-calling round trip. Evals need Ollama running locally (`ollama list` shows the pulled models).
- Embeddings (Milestone 7's lab):
  - **The model:** `config/models.json` `embedding` names it, its vector size (768, the `embeddings` column's) and its task prefixes. That's `ollama:embeddinggemma`, so run `ollama pull embeddinggemma` once. Override it with `EMBEDDING_MODEL`.
  - **Calls:** they go through the provider module: `createEmbedder()` in `src/llm/modelClient.ts`, with `embed()` on the Ollama and Gemini providers.
  - **Storage:** vectors live in the `embeddings` table (kind `title` | `synopsis` | `history`, one row per text and model, HNSW cosine index). `src/lab/embeddings.ts` has `ensureEmbeddings()`, which embeds only new or changed text, and `nearest()`.
  - **Synopses:** `pnpm lab:synopses` fills `anime.synopsis` from AniList for every listed or pooled show.
  - **The eval's frozen synopses:** `pnpm eval:synopses` freezes them for the eval's shows into `apps/server/eval/local/synopses.json`. It refuses to overwrite.
  - **What stays local:** `eval/local/` is gitignored. Synopses are publishers' text, and this repo is public.
  - **Hybrid title search:** with `SEARCH_VECTORS=on`, `search_my_list` also embeds its queries and compares them with each listed show's `title` vector (its names, `src/lab/titles.ts`, embedded after each sync). The meaning only reorders the shows the words found, by reciprocal rank fusion (`MeaningSearch` in `src/list/search.ts`; `extras: "always"` lets shows only the meaning found join too, never as clear). Clear matches still come from the words alone. `pnpm eval --search vectors` runs the update eval with it, and `pnpm lab:search-replay --results <an update eval's JSON>` replays a run's recorded searches with trigram alone and with each rule, without calling a model. Eval and replay embeddings are cached in `eval/local/embeddings/`.
  - **Semantic recommendations:** with `RECOMMEND_SEMANTIC_WEIGHT` above 0 (up to 1), `find_candidates` also ranks each show by how well its synopsis fits the user's message: its similarity to the message minus its similarity to a request for nothing in particular, times `SEMANTIC_SCALE` and the weight (`src/recommend/semantic.ts`). The model sees no new fields. Synopsis vectors are embedded after each sync, for list and pool shows that have a synopsis (`pnpm lab:synopses`). `pnpm eval:recommend --semantic <weight>` runs the recommendation eval with it, on the frozen synopses in `eval/local/`.
- Web push: `pnpm --filter @kurisu/server push:keys` prints a VAPID key pair for `.env.local` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, plus `VAPID_SUBJECT=mailto:<email>`). Without them push is off. The server only sends to known browser push services (`src/push/send.ts`).
- Morning brief: a pg-boss queue (tables in the `pgboss` schema of the same database) runs inside the server and checks every 5 minutes for due briefs; `BRIEF_SCHEDULER=off` stops it. Settings are under You, in Settings (`/you/settings`), which also has "Send a brief now". Each brief starts its own chat, which the notification opens. Airing data comes from AniList (`src/anilist/`), cached 6 hours in `anilist_media`. A brief also says when a show starts airing (its first episode aired in the brief's window): a Plan to Watch show, or a sequel to a show the user completed that isn't on their list (TV, TV short or ONA; `briefs.alerts`). Sequels come from AniList's SEQUEL relations, cached a week in `anilist_sequels` (`src/anilist/sequels.ts`, refreshed after a sync and by the brief). A day with only premieres is sent with a template line, without a model call, and each premiere gets a show card; one not on the list has an Add button, which goes through Chat's confirmed add. On the user's Sundays (by the brief's local date) a brief also sums up the last 7 days and the year's goal (`src/brief/recap.ts`, from `stats/compute.ts`; the `sunday_recap` setting, on by default; `briefs.recap`); a quiet Sunday with only the recap is sent with it as the line, and a week with nothing watched or finished has no recap.
- Recommendations: the progress agent hands "what should I watch" messages to a recommendation agent (`src/recommend/`, prompt `recommend.v9`, the `recommend` role on Flash) through its `recommend_shows` tool. `find_candidates` ranks Plan to Watch, started and queued shows (Watching at episode 0), plus shows new to the user from their discovery pool, in code; shows that fit the time and years come first, and ones up to 5 minutes over or 2 years outside follow only when fewer than 3 fit ("old" is before 2000, "recent" the last 5 years); `present_picks` stores up to 3 checked picks (`recommendations` table) that Chat shows as cards. The discovery pool (`src/recommend/discovery.ts`: `anilist_catalog`, `discovery`, `discovery_runs`) is rebuilt from AniList in the background after a list sync, at most daily. Where to watch: `find_candidates` takes `services` ("on Netflix") or `on_my_services`, and keeps only shows AniList lists on one of them; list shows' links are the `anilist_media` rows, refetched after a sync when over a week old (`recommendableIds`), and pool shows' are on `anilist_catalog`. Pick cards name the user's services (`brief_settings.services`) plus any the request named (`brief/services.ts` `watchOn`), never another site. What's airing now: `find_candidates` takes `airing_now` ("this season", "airing now") and then searches only airing shows: the user's own, plus this season's series and last season's still airing (`season_shows`, most popular first, details in `anilist_catalog`; `src/recommend/season.ts`, rebuilt at most daily after a sync, before discovery). Season shows on the user's list, and sequels to shows they haven't completed, are left out; other requests never see them. Taste memory (`taste_genres`, `drop_reasons`) lives in `src/taste/`.
- Adding shows: prompts that list `search_anime` in their `tools` (v12 on) can find shows outside the list on AniList (`src/anilist/catalog.ts` stores provisional `anime` rows). Proposing a show that isn't on the list makes an add, which `propose.ts` always holds for the user's tap; undoing an add removes the show from MAL (`deleteListStatus`, still only reachable through `commit.ts`).
- List editing: the List screen's edit sheet and "+1 ep" post to `POST /list/:animeId/edit` and `/remove` (`src/writes/manual.ts`). They stage a proposal with `source: "user"` (keyed by a per-tap request id, so a retry writes once) and commit it through `commitProposal`, so every edit is in History and undoable.
- Adding a show outside Chat: `POST /list/add {animeId, status?, episodesWatched?, score?, requestId}` (`addEntry` in `src/writes/manual.ts`) puts a show kurisu has seen (on a list, or found by Search) on the list, at Plan to Watch unless the user picked a status, by the same rules as Chat's adds. The user's Add tap is the confirmation; it's a `source: "user"` add, undoable (which removes it from MAL). It refuses a show already on the list (`already_on_list`) or never seen (`unknown_anime`).
- Screens' reads (`src/today/`, `src/journal/`, `src/shows/`), none of which changes the list:
  - `GET /today`: Watching shows with aired episodes not watched yet (`outNow`, from `latestAiredEpisode` on the cached `anilist_media` rows, with where to watch), the next week's episodes of Watching shows and Plan to Watch premieres (`comingUp`), Watching shows that finished airing with episodes left (`continueWatching`), the latest daily brief that went out (its chat), and 3 friend activity items. It never calls AniList.
  - `GET /journal`: kurisu's changes (each with its diary note; undone ones flagged, undos themselves left out), MAL-site `list_events`, and each import as one line (undone with `POST /imports/:id/undo`), newest first, 100 at most.
  - `GET /shows/:animeId`: the `anime` row, the user's entry, airing (`airingView`), where to watch on their services, this show's journal, and sharing friends' entries. 404 for a show kurisu never stored. The synopsis is AniList's description (`descriptions` in `anilist/client.ts`), fetched the first time anyone opens the page through the urgent AniList client (waiting up to 4 s, `src/anilist/synopsis.ts`), cleaned to plain text without AniList's `~!spoilers!~`, and kept in `anime.synopsis` ("" when AniList has none; syncs never touch it). Opening a page also refreshes the show's `anilist_media` row in the background when it's missing or older than 6 hours.
  - `GET /search?q=`: AniList's title search (the urgent client; `SEARCHES_PER_MINUTE` per user, then 429 `rate_limited`; 502 `search_unavailable` when AniList fails), stored as `anime` rows like Chat's searches, each with the user's entry. With no words it lists this season's most popular shows from `season_shows`.
  - `GET /list` entries carry `airing` (latest aired, next episode and when) from the same cache. `GET /me` has `welcomed`, which `POST /me/welcomed` sets (`users.welcomed_at`; accounts that existed before it are marked welcomed).
- Stats (`src/stats/`, `/you/stats`): `GET /stats` adds up the whole list, this year's completions (MAL's finish date, or else the day kurisu or a sync saw the show completed; imports and MAL-site adds don't count), and the last 7 days (`changes` without undos, undone changes or imports, plus `list_events`). `PUT /stats/goal {target}` sets this year's goal (`yearly_goals`). `list_events` holds changes made on MAL's site: after the first sync, each sync compares MAL's list with the mirror before replacing it (`stats/events.ts`), recording a change only when MAL's time for it is newer than the mirror's.
- Diary (`src/diary/`, shown in the Journal, `/you/journal`): after a Chat message's updates commit, a separate reader (prompt `diary.v1`, the agent role's model) reads the message and the shows it updated, in the background, and calls `save_reactions`; code keeps a quote only if it's in the message word for word (`reactionWords`, otherwise the whole message) as a `diary_notes` row on that change, which an undo takes back. The progress agent never sees the diary. `GET /diary` lists the latest updates (kurisu's and MAL-site ones) with their notes; `DELETE /diary/notes/:id` deletes one. `pnpm eval:diary` runs the reader alone over the update cases' messages (their expected writes as the updated shows; `expect.reaction` labels), a few cents a run. Integration tests turn the diary off (`diary: false` in the harness) unless they're about it.
- Import from notes (`src/import/`):
  - **API:** `POST /imports {text}`, then `GET /imports/:id` until `review`; `PATCH /imports/:id/items/:itemId` for the user's answers; `POST /imports/:id/run`, then `/undo`; `DELETE` discards one in review.
  - **Read:** prompt `import.v1` (agent role) reads each line with one tool, `report_items`, and nothing else.
  - **Match and group:** code matches each title, grounded in that line's own words, on the list first and then on AniList, and groups it with `groupMatched` (the user's rules).
  - **Write:** a run writes the checked rows through `commitProposal` (`source: "import"`) in the background, about one a second, skipping any row whose entry changed since the review, and resumes after a restart. Undo reverses them newest first.
- Agent prompts live in `apps/server/src/agent/prompts/`. Any change to a prompt gets a new version (a new file, e.g. `progressSync.v2.ts`), because every agent run logs the prompt version and evals compare versions.
- Eval harness run: `pnpm eval` (Docker + Ollama). Filters: `--tag`, `--case`, `--file`, `--limit`; compare models with `--model provider:model` and prompts with `--prompt progress-sync@N`. Gemini runs are throttled (`--rpm`, default 60 calls a minute; the API key is on the paid tier, and a 90-case Flash-Lite run takes about 5 minutes and costs about $0.20). Reports update accuracy, wrong-write rate, clarification precision/recall, latency and cost, by tag, with every failure explained; JSON reports go to `apps/server/eval/results/` (gitignored).
- Hosting (`deploy/README.md`): the hosted kurisu is a Docker Compose stack (`deploy/compose.yaml`, project `kurisu-prod`: Postgres on `127.0.0.1:5433`, the server, the web app on `127.0.0.1:3080`, and a daily backup) on Cyril's PC, published by Tailscale Funnel at `https://<pc>.<tailnet>.ts.net`. It builds from its own checkout, `C:\Users\megar\repos\kurisu-prod`, detached at `origin/main`, with its settings in that checkout's `.env.prod` (from `deploy/env.prod.example`: its own MAL app, keys and database). Deploy with `bash deploy/deploy.sh` there; `bash deploy/copy-dev-data.sh` copies the dev database across once, before the first deploy. In production (`NODE_ENV=production`) the server needs `OWNER_MAL_USERNAME`: a new account must be that MAL account (`users.is_owner`, set at each login) or come from an invite, and anyone else gets `/?login_error=invite_only`. Invites (`src/invites/`): the owner makes one-time links on `/you/friends` (`POST /invites`, a week each; only the code's hash is stored); `/invite/<code>` shows who sent it (`OWNER_DISPLAY_NAME`, else the MAL username) and the beta terms, then logs in with `?invite=<code>`, and the callback uses the invite up in the same transaction that creates the account. Settings (`/you/settings`) logs out (which also drops this browser's push subscription) and deletes everything kurisu holds for the user (`DELETE /me`, cascading from `users`; MAL untouched). Model budgets (`src/budget/`): while there's an owner, Chat and imports turn other accounts away with 429 `daily_limit` (`FRIEND_DAILY_RUNS` agent runs in any 24 hours, default 100) or `monthly_limit` (everyone but the owner over `MONTHLY_MODEL_BUDGET_USD` this UTC month at list prices, default $5), before saving anything or calling a model. Every AniList client shares one pacer (`createAniListPacer`, 3 s apart), with chat searches going first. Production 500s say only "Something went wrong"; `GET /health/db` also checks the database.
- Friends (`src/friends/`, `/you/friends`): friendships are stored once per pair, smaller id first. Joining with an invite makes you friends with the inviter, and opening someone's friend link (`/friend/<code>`; the code is kept encrypted and hashed, `POST /friends/link/reset` replaces it) adds them. `GET /friends` returns your link, your friends with their taste match, and what they watched; `GET /friends/:id` adds the full match and their activity. Every friend view checks the friendship and 404s otherwise. The taste match (`match.ts`) is the cosine of both users' mean-centred scores on shows both scored, blended with the cosine of their `taste_genres` affinities (scores' weight n/(n+10)), as 0–100, or null below 5 shared scored shows and 3 shared genres. Activity (`activity.ts`) reads each friend's diary updates (kurisu's and MAL-site ones; never removals, imports or undone changes) as finished, dropped, started, watched, planned or rated. A diary note is shown only when its owner shares it (`PATCH /diary/notes/:id {shared}`). Someone with sharing off (`PUT /friends/sharing`, `users.share_activity`, switched in Settings and returned by `/me`) shows only their match. A friend's "loved, not on your list" Add opens `/chat/new?draft=…`, so the add still goes through Chat's confirmed add. The dev fake MAL gives id 5151 ("alex") their own list; tests set `h.fakeMal.lists`.
- Review queue (`src/review/capture.ts`, `review_items`): a chat reply goes to the queue in the background when its run failed (not a model outage) or claimed a change it didn't make, when a chat write is undone within 24 hours, or when the user taps "Report a problem" under the reply (`POST /chat/messages/:id/report {note?}`). One item per run and reason. Each keeps the message, up to 4 earlier turns, the reply, and the list before the run (eval snapshot entries, with that run's writes rolled back) plus its shows' airing. `pnpm review --env-file <the hosted .env.prod>` lists new items with their tool calls, `--export <id>` writes a draft case and snapshot into the gitignored `apps/server/eval/private/`, and `pnpm eval --dir private` runs the labeled ones (`apps/server/eval/README.md`). Never commit `eval/private/`; the labels are Cyril's.
- UI: the look is the kurisu design system (`apps/web/design/README.md`). Build every screen from its tokens (Tailwind colors like `bg-surface`, `text-ink-muted`) and its `k-` classes (`design/bundle.css`), and the icons in `apps/web/components/Icon.tsx`. Dark only. `design/` holds verbatim copies of the system's `tokens.json` and `bundle.css`; after copying a newer version, `pnpm --filter @kurisu/web design:tokens` regenerates `design/tokens.css`. Chat is a command log: each assistant message carries its `run` (RunMeta and the tool trace: the run, the one it escalated from and the recommender's, from `agent_runs` and `agent_run_steps`; `src/chat/runs.ts`, summaries in `chat/trace.ts`), a brief's message its `brief` card, and each chat `isBrief`. Tailwind's own palette, radii and shadows are removed (`app/globals.css`), and `test/designSystem.test.ts` fails on an off-system class (a palette color, `dark:`, a pill or shadow).
- Screens and navigation (`apps/web/app/(app)/`):
  - **The NavBar** (`layout.tsx`, `NavBar.tsx`) holds four screens: Today (`/today`, the home and the PWA's `start_url`, where logins land), List, Chat and You (`/you`). It's a bottom bar on phones and a rail on the left from 1024px. Today's tab counts the episodes out (`/today`), refetched when a write fires `notifyListChanged` (`lib/listChanged.ts`).
  - **You** holds the Journal, Stats, Taste, Friends and Settings (`/you/*`). The old `/list/*`, `/you/history` and `/you/diary` URLs redirect in `next.config.ts`. A sub-screen's ScreenHeader takes `back`, a chevron to where it belongs.
  - **The Journal** (`/you/journal`, `GET /journal`) is History and the diary in one dated log:
    - kurisu's changes, with Undo until undone (undone ones struck through);
    - MAL-site changes;
    - each import as one line, with Undo for the whole import;
    - notes under their update, which can be shared with friends or deleted.
  - **Finishing a show:** a write outside Chat that moves a show to Completed opens the "Finished" sheet (`components/FinishSheet.tsx`, `FinishProvider` in the layout, triggered by `useWriteToast` through `lib/finish.ts`). It shows:
    - episodes and hours watched;
    - a one-tap score (the edit path);
    - this year's goal meter filling by one;
    - the next sequel not on the list, from `GET /shows/:id`'s `sequels` (the `anilist_sequels` cache, refreshed in the background when a completed show's page opens).

    In Chat the same shows inline under the latest reply that finished a show.
  - **Chat on phones:** times sit above each entry under 640px, "↵ send" is hidden on touch, Report is a link on the RunMeta line, and an empty chat's examples use your own Watching shows ("watched ep 8 of …").
  - **Tasks open in a `Sheet`** (`components/Sheet.tsx`): from the bottom on phones, never stacked. A question before something lasting uses `useConfirm`, never `window.confirm`.
  - **Changes made outside Chat confirm in a `Toast`** (`components/Toast.tsx`, through `lib/useWriteToast.ts`), with Undo through the change log.
  - **Safe areas:** `viewportFit: "cover"`. The `pb-nav`, `pb-bar` and `bottom-bar` utilities (`app/globals.css`) keep content clear of the bar and the home indicator.
  - **Touch:** Chat's list gives each chat a ⋯ (rename, delete) on touch screens (`pointer-coarse:`), where hover never happens.
  - **Show pages** (`/shows/[id]`): the ShowHero, synopsis, where to watch, your updates and friends who have the show. Every show title and poster in the app links here (`showHref`, `components/ShowLink.tsx`), and only the show page links out to MyAnimeList. Its "+1 ep", Edit and Add use the List screen's write paths.
  - **Search & add** (`/search`, from the List's "+"): this season's shows before you type, recent searches kept on this device, then AniList's matches after a pause in typing. Add opens `components/AddSheet.tsx` (`POST /list/add`).
  - **Welcome** (`/welcome`, outside the NavBar): a new account's MAL callback lands there, and Today sends anyone with `welcomed` false there too. It has three skippable steps (install, the brief and its time, your services), and the end calls `POST /me/welcomed` and opens Import for an empty list, or Today otherwise. Install (`lib/install.ts`, `components/InstallPrompt.tsx`, also in Settings) uses the browser's `beforeinstallprompt`, captured early by `app/ServiceWorker.tsx`, or the Add to Home Screen steps on iPhone.
  - **Offline** (`public/sw.js`): pages always come from the network, and when it's gone the worker serves `/offline`, which it precaches with its built files. Built files and icons are cache-first, and the API is never cached. The List screen saves its list into Cache Storage (`lib/offline.ts`, cache `kurisu-data`) for `/offline` to show read-only; logging out and deleting the account clear it. In development the worker is registered as `/sw.js?dev=1` and caches nothing. A production build bakes the `/api` rewrite's target (`API_INTERNAL_URL`) in at build time.
  - **The List** shows each row's AiringCountdown (`components/AiringLine.tsx`, drawn in the browser) and a rows/covers toggle (PosterGrid, `?layout=grid`).

Next.js 16 ships version-matched docs in `apps/web/node_modules/next/dist/docs/`; read them before writing web code (see `apps/web/AGENTS.md`).
