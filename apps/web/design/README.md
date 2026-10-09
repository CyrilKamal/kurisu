# The kurisu design system

The app's look comes from the design system "kurisu" on claude.ai: https://claude.ai/artifact/UoY3mvw8Z4Yf8uutvEDYLw. Its brand book (the artifact's `project/README.md`) and each component's guidelines are the rules. Every screen uses its tokens and its `k-` classes.

These files are copies of version `1791536064-31ff` (2026-10-09):

- `tokens.json`: the tokens, verbatim.
- `bundle.css`: the component classes (`k-btn`, `k-log`, `k-write`, `k-row`, ...), verbatim except its first line, a Google Fonts `@import`: `app/layout.tsx` loads Inter, Source Serif 4 and JetBrains Mono with `next/font` instead.
- `tokens.css`: generated from `tokens.json` by `pnpm --filter @kurisu/web design:tokens` (`build-tokens.mjs`). Don't edit it.

`app/globals.css` imports `tokens.css` and `bundle.css` (in the `components` layer, so Tailwind utilities can adjust layout) and maps the colors and the three faces into Tailwind (`bg-surface`, `text-ink-muted`, `rounded-control`, `font-serif`).

Type: Inter for words and numbers (with tabular figures, so columns line up), Source Serif 4 for show and screen titles, and JetBrains Mono only for what the agent prints: RunMeta, the tool trace and proposal ids.

To take a newer version of the system: copy its `project/tokens.json` and `project/components/bundle.css` here (dropping the font `@import`), run `design:tokens`, update the version above, and check the screens.

The 23 icons are in `components/Icon.tsx`, as inline SVG in `currentColor`. The logo stays as `lib/brandMark.ts` draws it, as the system says, until final art replaces it.
