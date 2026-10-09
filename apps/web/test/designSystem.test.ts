import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The app's look is the kurisu design system (design/README.md): its tokens and k- classes.
 * Tailwind's own palette, radii and shadows are removed (app/globals.css), so a class like
 * `bg-zinc-100` would silently do nothing; this catches one before it ships.
 */
const ROOTS = ["app", "components", "lib"];
const OFF_SYSTEM = [
  // Tailwind's palette, and plain black or white.
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  /\b(?:bg|text|border)-(?:white|black)\b/,
  // A light/dark split: the app is dark only.
  /\bdark:/,
  // Corners past 4/6px, pills and circles.
  /\brounded(?:-(?:xs|sm|md|lg|xl|2xl|3xl|full))?\b(?!-)/,
  // Shadows, blur and gradients.
  /\b(?:shadow|drop-shadow)(?:-(?:xs|sm|md|lg|xl|2xl))?\b(?!-)/,
  /\bbackdrop-blur\b/,
  /\bbg-(?:linear|radial|conic|gradient)-/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the design system", () => {
  it("is the only source of colors, corners and shadows in the app's classes", () => {
    const root = join(import.meta.dirname, "..");
    const found = ROOTS.flatMap((dir) => sourceFiles(join(root, dir)))
      // The logo draws its own placeholder colors, as the system says to keep it.
      .filter((file) => !file.endsWith("brandMark.ts"))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, i) =>
            OFF_SYSTEM.some((pattern) => pattern.test(line))
              ? [`${file.slice(root.length + 1)}:${String(i + 1)}: ${line.trim()}`]
              : [],
          ),
      );
    expect(found).toEqual([]);
  });
});
