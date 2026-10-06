# Anime Agent — Design Doc

Sep 29, 2026 · @Cyril

## Overview and goals

A personal agent that runs your anime and manga life through conversation: you tell it what you watched or read, and it keeps MyAnimeList (MAL) in sync, tells you what dropped today, and picks what to watch next. It ships as an installable web app (PWA) and doubles as an interview showcase for agentic LLM engineering.

**Goals**

- Natural-language progress updates that write to MAL correctly, with no manual list editing.
- A daily morning brief of new episodes for shows on your list, delivered by push notification.
- Recommendations drawn from your own backlog first, then from shows new to you that fit your taste, not generic popularity.
- Measurable reliability: a tool-call eval set with tracked accuracy.

**Non-goals (v1)**

- Hosting, streaming or linking to unlicensed content.
- Generating art, translations or stories.
- A native mobile app or social features.
- Manga release tracking (deferred until anime flows are solid).

## User experience

Three flows cover v1; progress sync is the core and ships first.

**1. Progress sync.** The user types something like "finished Apothecary ep 7, dropping the isekai one." The agent resolves each title against the user's list, shows the proposed changes, and writes them to MAL. Clear matches write immediately with an undo; ambiguous ones ("the isekai one" matching three shows) ask first.

**2. Morning brief.** Each day at a user-set time, a push notification lists new episodes for shows marked Watching, with the next episode number and where it streams. Tapping it opens the chat, so the user can reply "watched it" in one step.

**3. What to watch.** The user asks for something with constraints ("40 minutes, something chill"). The agent picks from Plan to Watch and in-progress shows, and from shows new to the user that fans of their favorites like or that top the genres they rate highest (found on AniList). It weighs runtime, airing status and the user's recent ratings and drops, puts their own list first when it fits about as well, and explains each pick in one line. A new show can be added to Plan to Watch from its card, with the user's confirmation.

The app has two screens: **Chat** for talking to the agent, and **List** showing the mirrored MAL list with a change log, so every agent write is visible and reversible.

## Architecture

The app talks only to a server-side agent backend, which holds MAL tokens, runs the daily jobs and never lets the model write to MAL outside the commit step.

&#91;embedded content: system architecture · PWA, agent backend, data sources\]

The agent reads the user's list from the Postgres mirror, pulls airing schedules from AniList (keyed by MAL ID), and reaches MAL only through `commit_update`. Next.js serves the PWA; the backend can be a TypeScript or Python service with a queue-backed cron for briefs.

## Agent design

The agent is a tool-calling loop where reads are free and every write goes through a proposal step, so the model never mutates MAL directly.

| Tool | Purpose | Side effect |
| --- | --- | --- |
| `search_my_list` | Fuzzy-match a title or nickname against the user's mirrored list | None |
| `get_entry` | Current status, progress and score for one title | None |
| `search_anime` | Find a show that isn't on the user's list, by title, on AniList | None |
| `propose_update` | Stage a status, episode, chapter or score change; returns a proposal ID | Writes a pending row locally |
| `commit_update` | Apply a proposal to MAL and the mirror | Writes to MAL |
| `get_airing_today` | New episodes for Watching shows, from AniList schedules | None |
| `recommend` | Rank backlog candidates and shows new to the user against constraints and taste memory | None |

**Safe writes.** `commit_update` only accepts a proposal ID, never raw arguments. Low-confidence matches return to the user for confirmation before commit. Adding a show that isn't on the list always waits for the user's confirmation, however clear the match. Each proposal has an idempotency key, so a retried commit never double-counts episodes. Every commit is logged with the prior value for undo.

**Memory.** Three layers: the list mirror (authoritative progress state, in Postgres), taste memory (structured drop reasons and rating patterns, updated after each session), and short conversation context. The model reads state through tools rather than holding the whole list in its prompt.

**Model routing.** Development runs on free models only, behind a thin provider interface, so a swap is a config change. Gemini Flash-Lite (free tier, about 500 requests a day) handles parsing and routine sync; full Gemini Flash (about 20 free requests a day) handles recommendations and ambiguous requests. Eval runs use a local model through Ollama, so repeated test runs cost nothing and hit no rate limits. Google may use free-tier prompts to improve its products, so only the developer's own list data goes through it; a paid tier comes before other users' data does. Any swap has to beat the current model on the eval set. Brief generation is templated, with the model only writing the summary line, which keeps the daily per-user cost near zero.

**Observability.** Every agent run is logged from milestone 2 onward: prompt version, model, tool calls with arguments, latency, token counts and outcome. The same logs feed cost and latency dashboards and supply real failures for the eval set.

## Evaluation

The headline metric is end-to-end update accuracy: the share of natural-language messages that produce exactly the right MAL writes, measured on a fixed test set before every prompt or model change.

**Test set.** Start with about 150 messages written against a snapshot of a real list, each labeled with the expected tool calls and arguments. Cover plain updates, nicknames and abbreviations ("JJK", "Frieren"), multi-show messages, relative progress ("watched two more"), sequel seasons that are separate MAL entries, and deliberately ambiguous inputs where the right answer is a question.

| Metric | What it measures | v1 target |
| --- | --- | --- |
| Update accuracy | Correct title, field and value on every write | 95% |
| Wrong-write rate | Writes that should not have happened | Under 1% |
| Clarification precision | Asked only when genuinely ambiguous | 90% |
| Median latency | Message to confirmed write | Under 3 s |
| Cost per update | Model spend per message | Tracked, no target |

The harness runs against a fake MAL client, so tests are fast, free and repeatable. Real-world failures from the change log get added to the set as regression cases.

## Risks, open questions and milestones

The biggest risk is data sourcing, not the agent: MAL has no episode-level schedule and streaming services have no public APIs.

| Risk | Mitigation |
| --- | --- |
| MAL OAuth only supports the plain PKCE method | Implement the flow by hand; cover it with an integration test |
| MAL rate limits are undocumented | Read from the local mirror; sync on login and after writes only |
| AniList-to-MAL mapping gaps | Map via AniList's MAL ID field; log and skip unmapped titles |
| Streaming availability data is patchy | Show "where to watch" only when known; never guess |
| Wrong writes erode trust | Proposal-then-commit, undo log, wrong-write rate as a tracked metric |

**Open questions**

- [x] Streaming availability for the brief: decided. v1 uses AniList external links, filtered to the services the user says they subscribe to (asked once at setup). The brief names a service only on a match and stays silent otherwise; TMDB watch providers are deferred.
- [x] Clear Google's outside-activities process before inviting outside users.

**Milestones**

1. MAL login, list mirror and List screen.
2. Progress-sync agent with the eval harness and first 150 test cases.
3. Morning brief with web push.
4. Recommendations and taste memory.
5. Invite a handful of friends; add their failures to the eval set.
6. Stretch: distill the parsing step into a fine-tuned small open model (1–3B) trained on labeled update messages, served locally. Compare it with Flash-Lite on accuracy, latency and cost.
