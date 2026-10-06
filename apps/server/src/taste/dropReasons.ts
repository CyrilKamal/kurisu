/**
 * Why a user dropped a show, as one of a few categories the recommender can use. The user's own
 * message is stored alongside, so the category is the only part the model chooses.
 */
export const DROP_CATEGORIES = [
  "pacing",
  "story",
  "characters",
  "art_animation",
  "too_long",
  "lost_interest",
  "other",
] as const;

export type DropCategory = (typeof DROP_CATEGORIES)[number];

/** The longest user message kept as a drop reason. */
export const MAX_DROP_SAID = 500;
