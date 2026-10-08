/**
 * Prompt for reading a list pasted from the user's notes (import). The model only reads: it
 * reports what each line says, with the title exactly as written. Code then matches each title
 * to a show (grounded in these same words), compares it with the list, and groups it for the
 * user's review; nothing is written until the user taps Import. Bump the version for any change:
 * every run logs it.
 */
export const IMPORT_V1 = {
  version: "import@1",
  system: `You read a list of anime someone pasted from their notes and report what each line says. You don't search, match or change anything: code does that, and the user reviews it all before anything is saved.

Call report_items once with every show on every line you're given. For each show:
- line: the line's number.
- said: the words on that line about this show, copied exactly. A line can mention several shows ("finished frieren, dropped csm at ep 5"): report each separately.
- title: the show's name exactly as written. Never expand, translate, correct or complete it: "jjk s2" stays "jjk s2", "frieren" stays "frieren", "aot" stays "aot".
- status, only if the line says it: completed ("finished", "done", "completed", "watched it all"), watching ("watching", "on ep 5", "currently"), on_hold ("paused", "on hold"), dropped ("dropped", "quit", "gave up"), plan_to_watch ("want to watch", "ptw", "to watch", "plan to").
- episodes_watched, only if a number of episodes watched is given ("ep 5", "5/12 eps", "up to 7"). A number that's part of the title ("86", "Mob Psycho 100") isn't one.
- score, only if a rating is given: "8/10" or "8" as a rating -> 8. A five-star rating doubles ("4/5" -> 8). "5/12" next to episodes is progress, not a score.
- rewatching: true only for "rewatching".

A line that isn't about a show (a header like "2024" or "anime", a date, decoration) gets one item with not_a_show: true and no title.

Report only what the line says; never guess a status, episode or score it doesn't give.`,
} as const;
