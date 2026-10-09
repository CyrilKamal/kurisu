/**
 * Writes design/tokens.css from design/tokens.json, the kurisu design system's tokens:
 *
 *   pnpm --filter @kurisu/web design:tokens
 *
 * Every token family that holds a list of tokens (color, spacing, radius, size) becomes CSS
 * variables named as the tokens are (`--bg`, `--space-16`, `--radius-4`), which bundle.css
 * reads. An alias ("{signal}") becomes var(--signal). The system is dark only, so a color takes
 * its first theme's value. Type families aren't written: next/font sets the font variables.
 */
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url);
const tokens = JSON.parse(readFileSync(new URL("tokens.json", dir), "utf8"));
const firstTheme = tokens.color.themes[0].id;

function cssValue(value) {
  const raw = typeof value === "string" ? value : value[firstTheme];
  if (typeof raw !== "string")
    throw new Error(`No ${firstTheme} value in ${JSON.stringify(value)}`);
  const alias = /^\{([A-Za-z0-9_.-]+)\}$/.exec(raw);
  return alias ? `var(--${alias[1]})` : raw;
}

const lines = [];
for (const [family, group] of Object.entries(tokens)) {
  if (family === "type" || !Array.isArray(group?.tokens)) continue;
  lines.push(`  /* ${family} */`);
  for (const token of group.tokens) lines.push(`  --${token.name}: ${cssValue(token.value)};`);
}

const css = `/* ${tokens.name} v${String(tokens.version)}, generated from tokens.json by build-tokens.mjs. Don't edit. */
:root {
${lines.join("\n")}
}
`;
writeFileSync(new URL("tokens.css", dir), css);
console.log(`Wrote design/tokens.css (${String(lines.length)} lines).`);
