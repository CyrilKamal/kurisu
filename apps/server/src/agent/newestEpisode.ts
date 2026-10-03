const NEWEST =
  /\b(?:newest|latest|new)\s+(?:ep|eps|episode|episodes)\b|\b(?:ep|eps|episode|episodes)\s+that\s+(?:just\s+)?(?:dropped|came out|aired)\b|\bjust dropped\b|\bcaught up\b/i;
const EPISODE_NUMBER =
  /\b(?:ep|eps|episode|episodes)\s*\d+\b|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:new\s+|more\s+)?(?:ep|eps|episode|episodes)\b/i;

/**
 * Whether the user means "the newest episode" without saying which ("watched the newest ep of
 * X", "the ep that dropped today", "caught up on X"). The app can't look that up until it has
 * airing schedules (Milestone 3), so progress from such a message is held for confirmation.
 */
export function mentionsNewestEpisode(message: string): boolean {
  return NEWEST.test(message) && !EPISODE_NUMBER.test(message);
}
