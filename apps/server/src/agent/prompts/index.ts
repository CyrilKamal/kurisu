import { PROGRESS_SYNC_V1 } from "./progressSync.v1.js";
import { PROGRESS_SYNC_V3 } from "./progressSync.v3.js";

/** Every prompt version, so the eval can compare them (pnpm eval --prompt progress-sync@1). */
export const PROMPTS = {
  [PROGRESS_SYNC_V1.version]: PROGRESS_SYNC_V1,
  [PROGRESS_SYNC_V3.version]: PROGRESS_SYNC_V3,
} as const;

/** The prompt the app uses. */
export const CURRENT_PROMPT = PROGRESS_SYNC_V3;
