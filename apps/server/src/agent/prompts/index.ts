import { PROGRESS_SYNC_V1 } from "./progressSync.v1.js";
import { PROGRESS_SYNC_V3 } from "./progressSync.v3.js";
import { PROGRESS_SYNC_V4 } from "./progressSync.v4.js";
import { PROGRESS_SYNC_V5 } from "./progressSync.v5.js";
import { PROGRESS_SYNC_V6 } from "./progressSync.v6.js";

/** Every prompt version, so the eval can compare them (pnpm eval --prompt progress-sync@1). */
export const PROMPTS = {
  [PROGRESS_SYNC_V1.version]: PROGRESS_SYNC_V1,
  [PROGRESS_SYNC_V3.version]: PROGRESS_SYNC_V3,
  [PROGRESS_SYNC_V4.version]: PROGRESS_SYNC_V4,
  [PROGRESS_SYNC_V5.version]: PROGRESS_SYNC_V5,
  [PROGRESS_SYNC_V6.version]: PROGRESS_SYNC_V6,
} as const;

/** The prompt the app uses. */
export const CURRENT_PROMPT = PROGRESS_SYNC_V5;
