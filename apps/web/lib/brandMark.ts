/**
 * The kurisu mark: a "K" whose upright stroke is a semicolon, inside a gear-toothed progress
 * ring. A placeholder until there's final art; every app icon is drawn from this SVG.
 */

const INK = "#fafafa";
const RING = "#3f3f46";
const PROGRESS = "#f59e0b";
const BACKGROUND = "#111114";

const CENTER = 256;
const RING_RADIUS = 172;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** The semicolon-K, drawn on a 512 x 512 canvas. */
const K = [
  `<circle cx="212" cy="196" r="26" fill="${INK}"/>`,
  `<circle cx="212" cy="300" r="26" fill="${INK}"/>`,
  `<path d="M232 314 Q232 352 194 372 L186 360 Q208 344 210 322 Z" fill="${INK}"/>`,
  `<path d="M254 246 L330 162 M262 258 L334 350" stroke="${INK}" stroke-width="36" stroke-linecap="round" fill="none"/>`,
].join("");

const GEAR = [
  ...Array.from(
    { length: 12 },
    (_, i) =>
      `<rect x="${String(CENTER - 17)}" y="47" width="34" height="34" rx="6" fill="${RING}" transform="rotate(${String(i * 30)} ${String(CENTER)} ${String(CENTER)})"/>`,
  ),
  `<circle cx="${String(CENTER)}" cy="${String(CENTER)}" r="${String(RING_RADIUS)}" stroke="${RING}" stroke-width="22" fill="none"/>`,
  // About three quarters done, starting at the top.
  `<circle cx="${String(CENTER)}" cy="${String(CENTER)}" r="${String(RING_RADIUS)}" stroke="${PROGRESS}" stroke-width="22" fill="none" stroke-linecap="round" stroke-dasharray="${(RING_CIRCUMFERENCE * 0.72).toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}" transform="rotate(-90 ${String(CENTER)} ${String(CENTER)})"/>`,
].join("");

export type BrandMarkVariant =
  /** Rounded tile, for browser tabs and the manifest's regular icons. */
  | "tile"
  /** Full-bleed square with the mark inside the safe zone, for Android's shaped icons and iOS. */
  | "maskable"
  /** White mark on transparent, for Android's monochrome notification badge. */
  | "badge";

export function brandMarkSvg(variant: BrandMarkVariant): string {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`;
  switch (variant) {
    case "tile":
      return `${open}<rect width="512" height="512" rx="112" fill="${BACKGROUND}"/>${GEAR}${K}</svg>`;
    case "maskable":
      // Android may crop to a circle of 80% of the width; the ring fits inside it at 80%.
      return `${open}<rect width="512" height="512" fill="${BACKGROUND}"/><g transform="translate(51.2 51.2) scale(0.8)">${GEAR}${K}</g></svg>`;
    case "badge":
      // Badges are tiny, so the K alone fills the canvas.
      return `${open}<g transform="translate(256 256) scale(1.8) translate(-269 -262)">${K}</g></svg>`;
  }
}
