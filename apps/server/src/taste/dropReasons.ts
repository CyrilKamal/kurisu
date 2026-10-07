/**
 * Why a user dropped a show, as one of a few categories the recommender can use. The user's own
 * message is stored alongside, so the category is the only part the model chooses. The categories
 * live in the shared contract, since the Taste page shows them too.
 */
export { DROP_CATEGORIES, type DropCategory } from "@kurisu/shared";

/** The longest user message kept as a drop reason. */
export const MAX_DROP_SAID = 500;
