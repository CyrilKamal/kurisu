# Eval set: writing test cases

The eval set is how we know the progress-sync agent works. Each case is one message you might send, plus what should happen on MAL. The harness runs every case against a fake MAL, starting each one from the same frozen snapshot of your list. It then reports update accuracy, wrong-write rate, clarification precision, latency and cost.

Target: about 150 cases.

## Quick start

1. Create a `.txt` file in `apps/server/eval/cases/`, such as `batch1.txt`, and write one case per line in the shorthand below. YAML files (format further down) work too, and both kinds can sit side by side.
2. Use `pnpm eval:lookup <words>` to find a show's exact title, MAL id, status and episode count.
3. Run `pnpm eval:validate`. It checks every file, points at the line, and suggests the title you probably meant. CI runs it too.
4. Run `pnpm eval:validate --verbose` to see exactly what each case expects once the rules below are applied.

`snapshots/my-list.json` is a sanitized copy of your list: titles, alternative titles, status, episode progress and whether each show has aired yet, with no scores, dates or username. Don't re-export it after you start writing: relative cases like "two more" depend on the frozen numbers.

`snapshots/varied-list.json` is the same list with 14 shows changed to states your real list lacks:
- **Mid-season:** Monster 30/74, Your Lie in April 3/22, Classroom of the Elite 4th Season 8/16, Misfit of Demon King Academy II Part 2 5/12
- **One before the finale:** Made in Abyss 12/13
- **A season or part in progress:** Spy x Family Season 3 4/13, Fire Force Season 3 Part 2 6/13
- **On hold part-way:** Darker than Black 10/25, Hyouka 11/22
- **Dropped part-way:** Servamp 3/12, Charlotte 6/13
- **Rewatching:** Fullmetal Alchemist 10/51, Code Geass (season 1) 3/25
- **A movie still to watch:** Penguin Highway

To write cases against it, start the file with `snapshot: varied-list`, and look shows up with `pnpm eval:lookup <words> --snapshot varied-list`. It's made by hand, so it's never re-exported.

`snapshots/airing.json` freezes AniList's airing data for the snapshots' Watching and airing shows (the newest aired episode of each), so "the newest episode" has the same answer on every run. The harness loads it with each snapshot. It was exported once with `pnpm eval:airing` and is never re-exported: the command refuses to overwrite it.

## Shorthand (fastest)

One case per line: the message exactly as you'd type it, `=>`, then what should happen. These examples use the made-up `examples` snapshot:

```text
snapshot: examples
// Lines starting with // are comments. A line like "tags: plain" tags every case below it.

watched ep 8 of fixture watching show => Fixture Watching Show: ep 8  #plain
FWS, two more episodes => FWS: ep 9  #nickname #relative
started season 2 of isekai chronicles => 900012: ep 1  #sequel // titles are shared, so use the id
finished another isekai fixture and dropping the isekai one => Another Isekai Fixture: completed; ask  #multi
what should I watch tonight? => none  #no-action

user: dropping the isekai one
bot: Which one: Another Isekai Fixture or Isekai Chronicles season 2?
the season 2 one => 900012: dropped  #ambiguous #history
```

After `=>`:

| Write | Means |
| --- | --- |
| `none` | nothing should be written and nothing asked |
| `ask` | the agent should ask (or hold a change for you to confirm) instead of writing |
| `<title or MAL id>: <fields>` | this write should happen. Separate several with `;`, and add `; ask` when another part of the message should get a question. |

Fields, separated by commas: `ep N` (the episode count after the update), `score N`, `rewatching`, `not rewatching`, or a status: `watching`, `completed`, `on hold`, `dropped`, `plan to watch` (or `ptw`).

- `#tags` go at the end of the line, and `// notes` after them.
- Earlier turns of a conversation go on the lines right above their case, as `user: …` and `bot: …`.
- `snapshot:` defaults to `my-list`.
- Case ids are made from the file name and the message's first words.

## YAML format

```yaml
snapshot: my-list
cases:
  - id: plain-apothecary-7            # unique across all files: lowercase, digits, dashes
    message: "finished apothecary ep 7"  # exactly what you'd type
    tags: [plain]                     # optional, used for per-category scores
    notes: "optional, for you"        # ignored by the harness
    expect:
      writes:
        - anime: "The Apothecary Diaries"
          episodes_watched: 7
```

Each write names an `anime` and at least one field:

| Field | Values |
| --- | --- |
| `status` | `watching`, `completed`, `on_hold`, `dropped`, `plan_to_watch` |
| `episodes_watched` | the episode count after the update (absolute, not "+2") |
| `score` | 0–10 |
| `is_rewatching` | `true` / `false` |

`anime` can be any title the snapshot knows: the main title, English, Japanese or a synonym, matched case-insensitively. It can also be a MAL id. If a title matches more than one entry, the validator tells you to use the id.

### Earlier turns (optional)

Add `history` when a message only makes sense after an earlier exchange, like a clarifying question and its answer, or "one more" after an update:

```yaml
  - id: followup-second-one
    message: "the second one"
    history:
      - role: user
        content: "dropping the isekai one"
      - role: assistant
        content: "Which one: Isekai Alpha or Isekai Beta?"
    expect:
      writes:
        - anime: "Isekai Beta"
          status: dropped
```

The agent sees the history as the conversation so far. Writes are still judged only on what it commits for the new message.

### Replies to a morning brief (optional)

To test a reply like "watched it", end the history with a brief written exactly the way the app writes one: a summary line, a blank line, one line per show (`- Title ep 12`, `- Title eps 11–12`, optionally followed by ` (premiere)` or ` on Crunchyroll`), a blank line, then the reply hint. Use titles exactly as `pnpm eval:lookup` shows them. Multi-line messages need YAML:

```yaml
  - id: brief-watched-it
    message: "watched it"
    tags: [brief-reply, multi]
    history:
      - role: assistant
        content: |
          Two shows have new episodes.

          - Kusuriya no Hitorigoto eps 7–8 on Crunchyroll
          - Upcoming Sequel ep 1 (premiere)

          Reply "watched it" once you've caught up on all of these.
    expect:
      writes:
        - anime: "Kusuriya no Hitorigoto"
          episodes_watched: 8
        - anime: "Upcoming Sequel"
          episodes_watched: 1
```

The harness reads the brief back out of that last message, as the app does from its own records. The agent holds any progress these rules don't allow (for example, "the 2nd ep" written to the second show in the list), and the validator warns about cases that expect a held write.

### Adding shows that aren't on the list (optional)

Some messages are about a show that isn't on the snapshot's list: "add X to my plan to watch", "watched ep 3 of X", "finished X, 8/10". The agent finds X with `search_anime` and proposes adding it. Every add waits for you to tap Add, so it's never a write: list it under `adds`. Each add counts as asking, so `clarify: true` is implied.

```yaml
  - id: add-frieren-ptw
    message: "add frieren to my plan to watch"
    tags: [add]
    expect:
      adds:
        - anime: "Sousou no Frieren"
  - id: add-finished-with-score
    message: "finished dandadan, 8/10"
    tags: [add]
    expect:
      adds:
        - anime: "Dandadan"
          status: completed
          score: 8
```

- **Which titles work:** the evals can't search AniList live. The titles your add cases use come from a frozen copy of AniList's answers in `snapshots/catalog.json`. Freeze a search once, before writing the cases that use it: `pnpm eval:catalog "frieren" "dandadan"`. It prints each show it found with its MAL id. A title already frozen keeps its first answer.
- **`anime`** is a title, English title or synonym from that frozen search, or the MAL id it printed. The validator rejects a title that isn't frozen, one that matches several shows, and a show that's already on the snapshot's list (that's an update).
- **The same rules apply as for writes:** a bare add means Plan to Watch, `episodes_watched` on its own means Watching, and `completed` fills in the episode count.
- **When several shows fit** ("add frieren" with two seasons frozen), expect a question instead: `clarify: true` and no `adds`.
- **A show missing from the frozen catalog** is found nowhere, so the agent should say it isn't on the list. Expect no writes and no `clarify`.

### What counts as correct

- **Writes**: a case passes only if the agent writes exactly the listed changes, no more and no less. Any write to an anime you didn't list counts as a wrong write.
- **Adds**: the adds the agent holds for you must be exactly the listed `adds`, no more and no less. They're never counted as writes.
- **`clarify: true`**: the agent should ask first, either with a question or with a change held for you to confirm, instead of writing. A case can list writes and set `clarify: true` together. For example, "finished X and dropped the isekai one" writes X and asks about the other.
- **No writes and no `clarify`**: the agent should do nothing, for example when the message isn't an update. Tag these `no-action`.
- **`reaction`** (optional, for the diary): `reaction: true` means the message says how you felt about a show it updates ("that finale was insane"), so a diary note should be saved. `reaction: false` means none should be. Leave it out and the diary isn't checked. `pnpm eval` ignores it; `pnpm eval:diary` runs only the diary reader over the cases with writes. It reports the labeled cases it got right, and lists the notes it saved in unlabeled cases so you can read them.

### Rules the agent applies automatically

You don't need to spell these out. The validator and the agent apply the same rules to your expected writes.

- Reaching the last episode sets `completed`, and ends a rewatch.
- `status: completed` with no episode count fills in the total, when MAL knows it.
- Progress on a `plan_to_watch` or `on_hold` show sets `watching`.
- A `dropped` show stays dropped unless you set a status.
- `is_rewatching: true` only applies to a show that's completed. The validator rejects it otherwise.
- A write that changes nothing gets a warning, since it's usually a typo in the case.
- Progress on a show the snapshot says hasn't aired yet (more episodes, or completing it) is held for you to confirm instead of written, so the validator warns about cases that expect it. Status changes, like dropping it, are written as usual. An unaired show also doesn't count as "in progress" when the agent picks between seasons, but a show you're rewatching does.
- A message that means "the newest episode" without a number ("watched the newest ep", "the ep that dropped", "caught up on X") is written as the newest aired episode from the frozen airing data (below). If that data has no newest episode for the show, or the write is a different episode, the change is held for you to confirm. The validator warns about cases that expect such a write. `pnpm eval:lookup` shows the frozen newest episode as "newest aired ep N".
- A score from a message with no number in it ("that was so good") is held for you to confirm, since you didn't give one. The validator warns about cases that expect it written.

Example: `episodes_watched: 12` on a 12-episode show you're watching is expected as episodes 12 + `completed`.

### What words mean (your decisions)

Label every case the same way for the same wording, or no agent can pass them all. Decisions so far:

- **"Started X" means episode 1 is watched.** Label it `X: ep 1`. On a Plan to Watch show, the status then moves to Watching automatically. "Picked up X" and "going to start X (again)" mean the same.
- **"Just watched X" with no number means the next episode** (one more than the list has).
- **"Thinking about starting X" means nothing yet:** no write.
- **"Resuming X" means back to Watching,** with the episode count unchanged.
- **Right after a morning brief**, for the shows it listed:
  - "Watched it", "watched them (all)", "done", "finished", "caught up", "saw them": caught up on everything, each show up to the last episode the brief listed.
  - Naming shows without a number ("watched wistoria", "the wistoria eps and daemons"): each named show up to its last listed episode; the others are left alone.
  - A count ("a wistoria ep", "one ep", "3 clevatess"): that many more episodes. "The other two" or "the others" means the rest, each up to its last listed episode.
  - An episode number ("ep 8", "the 2nd ep", "the first ep", "the premiere" = ep 1): that episode of the show the brief lists it for, not the show at that place in the list.
  - "Didn't watch any yet", "haven't seen them": nothing.
- **Shows that aren't on your list** (adds always wait for your tap):
  - "Started X" or "watched N eps of X" adds it with that progress; "finished X, 10/10" adds it as Completed with the score.
  - "Gonna start X" adds it to Plan to Watch. For a show already on your list, "going to start X" still means started (ep 1).
  - A name that later seasons' names start with ("Mushishi", "Natsume Yuujinchou") asks which one, as it does for your list.
  - "Add X" for a show already on your list changes nothing and asks nothing; it says where the show is.

## Coverage checklist

These categories come from the design doc. Aim for a spread, and use them as tags:

- [ ] `plain`: plain updates ("watched ep 5 of X")
- [ ] `nickname`: nicknames and abbreviations ("JJK", "Frieren")
- [ ] `multi`: several shows in one message
- [ ] `relative`: relative progress ("watched two more")
- [ ] `sequel`: sequel seasons that are separate MAL entries
- [ ] `ambiguous`: deliberately ambiguous inputs where the right answer is a question
- [ ] `add`: shows that aren't on the list (see "Adding shows" above). For example:
  - [ ] "add X" and its variants ("put X on my ptw", "add X to my list")
  - [ ] "watched ep 3 of X" or "finished X, 8/10" for a show that isn't on the list
  - [ ] a vague name that fits several shows, where the right answer is a question
  - [ ] "add X" for a show that's already on the list: no add; the agent should say where it is
  - [ ] a show it shouldn't add: mentioned in passing, or a plan ("might watch X")

Tips:
- Write messages the way you actually type: lowercase, typos and all.
- Each case starts fresh from the snapshot; cases never depend on each other.
- A title that isn't on your list, and isn't one the case asks to add, should get "it isn't on your list" and nothing else: a `no-action` case.

`cases/examples.yaml` shows the format against a separate made-up list (`snapshots/examples.json`).

## Running the eval

```bash
pnpm eval                                  # every case, on the eval model in config/models.json
pnpm eval --tag nickname                   # one category (repeat --tag for several)
pnpm eval --case plain-apothecary-7        # one case (repeatable)
pnpm eval --model ollama:qwen3.6:27b       # compare another model
pnpm eval --model gemini:gemini-3.5-flash-lite   # the app's model, throttled to 60 calls a minute
pnpm eval --prompt progress-sync@1         # compare an older prompt version
```

It needs Docker (it starts a throwaway Postgres) and Ollama running with the model pulled. Each case starts from the snapshot. The real agent runs with the real prompt and tools, and a fake MAL client records writes instead of sending them.

The report prints:

- **Update accuracy:** the share of cases handled exactly right.
- **Wrong-write rate:** writes that shouldn't have happened, out of all writes.
- **Clarification precision:** of the times it asked, how often asking was expected. Recall is printed too.
- **Median latency** (and p90).
- **Cost per update:** $0 on a local model. The report also shows the equivalent at the agent model's paid prices.

It also breaks accuracy down by tag and, for every failure, shows the expected versus actual writes, the reply, and the tool calls the agent made. The full JSON report lands in `eval/results/` (gitignored).

## Recommendation cases

Recommendation cases check what Chat recommends for "what should I watch" messages. They live in their own files, named `recommend-<anything>.yaml`, and run separately with `pnpm eval:recommend`.

Each case runs the real flow:
1. The progress agent reads your message and hands it to the recommender.
2. The recommender searches your list (Plan to Watch and shows in progress) and the discovery pool (shows new to you).
3. It presents up to 3 picks.

Each case then checks every pick against the labels you give.

```yaml
snapshot: my-list
cases:
  - id: rec-movie-tonight
    message: "what movie should I watch tn"
    tags: [movie]
    expect:
      media_types: [movie]
  - id: rec-short-and-funny
    message: "got 25 mins, something funny"
    tags: [time, mood]
    expect:
      max_episode_minutes: 25
      genres_any: [Comedy]
      genres_none: [Horror]
  - id: rec-continue
    message: "what should i continue"
    tags: [continue]
    expect:
      source: in_progress
      must_not: ["Monster"]
```

Labels, all optional (`expect: {}` means "any sensible picks"):

- **`media_types`:** every pick is one of these: `tv`, `movie`, `ova`, `ona`, `special`, `tv_special` or `music`. For "a show" or "a series", the app uses `[tv, ona]`.
- **`max_episode_minutes`:** every pick's episodes (or the movie) run at most this long. A pick whose length is unknown fails it.
- **`grace_minutes`:** with `max_episode_minutes`, picks may run up to this many minutes over the limit, but every pick that fits has to come first. This matches the app: when fewer than 3 shows fit, it adds ones up to 5 minutes over.
- **`max_episodes_left`:** every pick has at most this many episodes left to watch, for "something I can finish this weekend". A pick whose episode count is unknown fails it.
- **`year_from`, `year_to`:** every pick started airing in these years; either end can be left open. **`grace_years`** allows picks up to that many years outside, after every pick inside them. This matches the app: when fewer than 3 shows fit the years, it adds ones up to 2 years outside. A pick whose year is unknown fails.
- **`clarify: true`:** the recommender should ask a question instead of picking, for example when "new" could mean new to you or recently aired.
- **`genres_any`:** the picks should have at least one of these genres, for a mood like "chill" or "funny". This is reported as **genre fit** and doesn't fail a case, since moods map to genres loosely.
- **`genres_none`:** no pick has any of these. This fails the case.
- **Genre names** are MAL's, spelled as MAL spells them ("Slice of Life", "Iyashikei", "Suspense"). The validator suggests the right spelling.
- **`source`:** where the picks should come from:
  - `list`: your Plan to Watch or shows in progress;
  - `plan_to_watch`;
  - `in_progress`: watching, on hold or rewatching;
  - `started`: in progress with at least one episode watched (a Watching show at episode 0 is only queued);
  - `new`: not on your list;
  - `any`: the default.
- **`must_not`:** shows that must never be picked: a title from the snapshot or the discovery pool, or a MAL id. `pnpm eval:lookup` finds list titles.
- **`picks: false`:** nothing should be recommended, because nothing can fit.
- **`streams_on`:** every pick streams on at least one of these services, by AniList's official links (frozen in `snapshots/streaming.json`). For "anything on Netflix", `[netflix]`. The ids: `crunchyroll`, `netflix`, `hidive`, `hulu`, `disney_plus`, `prime_video`, `max`, `apple_tv`, `tubi`, `youtube`, `bilibili_tv`, `retrocrush`, `adult_swim`. A pick AniList lists on none of them fails.

- **`airing_now: true`:** every pick is airing now, for "what's good this season". `snapshots/season.json` holds what was airing (this season's series and last season's still airing), frozen once with `pnpm eval:season`.

Next to `message`, a case can also set **`services`**: the streaming services you have in it, as on the Brief page (the same ids). It's empty by default. "On my services" means these, and cards name only these plus any the message asks for.

```yaml
  - id: rec-my-services
    message: "something i can stream tonight"
    services: [crunchyroll, hidive]
    expect:
      streams_on: [crunchyroll, hidive]
```

### What counts as correct

A case is right when all of these hold:
- the message reached the recommender;
- there's at least one pick (none for `picks: false`);
- every pick is valid: not completed, dropped or unaired, and from your list or the pool;
- every pick is within the hard labels: `media_types`, `max_episode_minutes`, `genres_none`, `source`, `must_not` and `streams_on`.

The report also shows:
- the share of valid picks;
- the share of picks within the labels;
- genre fit;
- picks per case;
- median and p90 latency of both agents together;
- cost per case at the configured models' prices.

### Frozen data, and what this doesn't measure

- **Frozen data:** `snapshots/details.json` holds MAL's genres, episode length and community score for the snapshot's shows. `snapshots/discovery.json` holds your discovery pool's AniList data and how strongly it points at each show. Both were frozen once with `pnpm eval:recommend-data`, which refuses to overwrite them. Neither holds a score you gave, or which favorites led to each pool show.
- **Where shows stream:** `snapshots/streaming.json` holds AniList's official streaming links for the snapshot's Plan to Watch, Watching, On hold and rewatching shows, and for the pool's shows. It was frozen once with `pnpm eval:streaming`, which refuses to overwrite it.
- **Taste isn't measured:** the snapshot has no scores, so taste is neutral. These cases measure whether recommendations follow the request (length, kind of show, mood, source), not how well they match your taste.

### Checklist (yours to write; aim for about 20)

- [ ] a movie, and "a show" or "a series"
- [ ] time limits ("I have 30 minutes", "something under an hour")
- [ ] moods ("something chill", "funny", "sad", "hype")
- [ ] things to avoid ("nothing scary", "no romance")
- [ ] continuing something in progress
- [ ] something from Plan to Watch, and something new ("I haven't seen")
- [ ] a short series ("something I can finish this weekend")
- [ ] a mix of constraints ("a short funny movie")
- [ ] a request nothing can fit (`picks: false`)
- [ ] a recommendation in the same message as an update ("finished X, what next?")
- [ ] a streaming service ("anything on Netflix"), and your own services ("something I can stream"), with `services` set
- [ ] a service the app can't check ("anything on iQIYI": it should say so, `picks: false`)

`cases/recommend-examples.yaml` shows the format with a few examples.

```bash
pnpm eval:recommend                        # every recommendation case, on the configured models
pnpm eval:recommend --case rec-movie-tonight
pnpm eval:recommend --model gemini:gemini-3.5-flash-lite   # try another recommender model
```

A case costs about 1¢ on the paid tier, and takes 10 to 15 seconds.

## Import cases

Import cases check the "Import from your notes" flow. They live in their own files, named `import-<anything>.yaml`, and run with `pnpm eval:import`. Each case runs the app's own import code:
1. The model reads the notes.
2. Code matches each show on the snapshot's list, then in the frozen AniList catalog.
3. Code groups each row, as the review screen would show it.

Nothing is written. Each row is compared with what you expect.

```yaml
snapshot: my-list        # or "empty", for onboarding from notes alone
cases:
  - id: import-mixed-list
    tags: [merge]
    notes: |
      2024 watchlist
      kusuriya ep 10
      finished bocchi 9/10, dropped cowboy bebop at ep 5
      perfect blue 10/10
    expect:
      - line: 2
        group: update
        anime: Kusuriya no Hitorigoto
        change: { episodes_watched: 10 }
      - line: 3
        group: update
        anime: Bocchi the Rock!
      - line: 3
        group: disagree
        anime: Cowboy Bebop
      - line: 4
        group: add
        anime: PERFECT BLUE
        change: { status: completed, score: 10 }
```

- **`notes`:** the text as you'd paste it. Lines count from 1, blank lines included.
- **`expect`:** one row per show the notes mention, in order: by line, then by place on the line ("finished X, dropped Y" is two rows on one line). **A line you leave out should come back as not a show** (a header like "2024 watchlist").
- **`group`:**
  - `add`: not on the list, pre-checked;
  - `update`: forward only, pre-checked;
  - `up_to_date`;
  - `disagree`: lower progress, a finished show, a contradicting status or score; keeps MAL unless tapped;
  - `which_one`: several shows fit;
  - `not_found`;
  - `not_a_show`.
- **`anime`:** the show, needed for `add`, `update`, `up_to_date` and `disagree`. Use a title from the snapshot or the frozen catalog, or a MAL id. For `which_one` it's optional: the right show must then be among the choices. For a show that isn't on the list, freeze its search first: `pnpm eval:catalog "<title as you'd write it>"`.
- **`change`:** optional, the fields the row should write: `status`, `episodes_watched`, `score`, `is_rewatching`. Only the fields you give are checked.

**What counts as right:** every row's group, show and given fields match, and no extra rows.

**What the report shows:**
- **Wrong pre-checked rows**, the number that matters most: rows one Import tap would have written wrongly. It must be 0.
- rows and cases right;
- precision and recall of the "?" rows (which one, disagree);
- latency and cost (about 0.05¢ a case on Flash-Lite).

### Checklist (yours to write)

- [ ] notes in your own style: bullets, numbering, commas, "eps", "/10", typos
- [ ] several shows on one line
- [ ] headers, dates and blank lines between shows
- [ ] nicknames ("jjk s2", "aot", "kusuriya") and a vague one that fits several shows
- [ ] progress ahead of MAL (an update) and behind it (a disagreement)
- [ ] a finished show the notes call dropped or watching
- [ ] a score where MAL has none, and one that differs
- [ ] "want to watch" for a show already on the list
- [ ] shows not on the list, with and without a status or score
- [ ] onboarding from an empty list (`snapshot: empty`)
- [ ] a title that only looks like another show's ("perfect blue" vs "Blue Period")

`cases/import-examples.yaml` and `cases/import-examples-onboarding.yaml` show the format with three examples.
