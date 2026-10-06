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

The harness reads the brief back out of that last message, as the app does from its own records. For a "watched it" reply, a write that isn't the last episode the brief listed for that show, or for a show the brief didn't list, is held for confirmation; the validator warns about cases that expect one.

### What counts as correct

- **Writes**: a case passes only if the agent writes exactly the listed changes, no more and no less. Any write to an anime you didn't list counts as a wrong write.
- **`clarify: true`**: the agent should ask first, either with a question or with a change held for you to confirm, instead of writing. A case can list writes and set `clarify: true` together. For example, "finished X and dropped the isekai one" writes X and asks about the other.
- **No writes and no `clarify`**: the agent should do nothing, for example when the message isn't an update. Tag these `no-action`.

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
- **"Watched it" right after a morning brief means caught up on everything in it:** every show the brief listed, up to the last episode it listed. "Watched them (all)", "saw both" and "caught up" mean the same. A reply naming one show ("watched frieren") follows the rules above.

## Coverage checklist

These categories come from the design doc. Aim for a spread, and use them as tags:

- [ ] `plain`: plain updates ("watched ep 5 of X")
- [ ] `nickname`: nicknames and abbreviations ("JJK", "Frieren")
- [ ] `multi`: several shows in one message
- [ ] `relative`: relative progress ("watched two more")
- [ ] `sequel`: sequel seasons that are separate MAL entries
- [ ] `ambiguous`: deliberately ambiguous inputs where the right answer is a question

Tips:
- Write messages the way you actually type: lowercase, typos and all.
- Each case starts fresh from the snapshot; cases never depend on each other.
- Titles that aren't on your list aren't supported in this milestone. The agent should say so and write nothing, so those are `no-action` cases.

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
