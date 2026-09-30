import { PROGRESS_SYNC_V1 } from "./progressSync.v1.js";

/** Every prompt version, so the eval can compare them (pnpm eval --prompt progress-sync@1). */
export const PROMPTS = {
  [PROGRESS_SYNC_V1.version]: PROGRESS_SYNC_V1,
} as const;

/** The prompt the app uses. */
export const CURRENT_PROMPT = PROGRESS_SYNC_V1;
