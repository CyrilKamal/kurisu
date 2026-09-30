# Eval set: writing test cases

The eval set is how we know the progress-sync agent works. Each case is one message you might send, plus what should happen on MAL. The harness runs every case against a fake MAL, starting each one from the same frozen snapshot of your list. It then reports update accuracy, wrong-write rate, clarification precision, latency and cost.

Target: about 150 cases.

## Quick start

1. Create a file in `apps/server/eval/cases/`, one per category, such as `plain.yaml` or `nicknames.yaml`.
2. Start it with `snapshot: my-list` and add cases (format below).
3. Run `pnpm eval:validate`. It checks every file and points at typos. CI runs it too.
4. Run `pnpm eval:validate --verbose` to see exactly what each case expects once the rules below are applied.

`snapshots/my-list.json` is a sanitized copy of your list: titles, alternative titles, status and episode progress, with no scores, dates or username. Look up the episode numbers there when a case depends on them. Don't re-export it after you start writing: relative cases like "two more" depend on the frozen numbers.

## Format

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
- A write that changes nothing gets a warning, since it's usually a typo in the case.

Example: `episodes_watched: 12` on a 12-episode show you're watching is expected as episodes 12 + `completed`.

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
