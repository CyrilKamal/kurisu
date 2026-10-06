import { PROGRESS_SYNC_V1 } from "./progressSync.v1.js";
import { PROGRESS_SYNC_V3 } from "./progressSync.v3.js";
import { PROGRESS_SYNC_V4 } from "./progressSync.v4.js";
import { PROGRESS_SYNC_V5 } from "./progressSync.v5.js";
import { PROGRESS_SYNC_V6 } from "./progressSync.v6.js";
import { PROGRESS_SYNC_V7 } from "./progressSync.v7.js";
import { PROGRESS_SYNC_V8 } from "./progressSync.v8.js";
import { PROGRESS_SYNC_V9 } from "./progressSync.v9.js";
import { PROGRESS_SYNC_V10 } from "./progressSync.v10.js";
import { PROGRESS_SYNC_V11 } from "./progressSync.v11.js";
import { PROGRESS_SYNC_V12 } from "./progressSync.v12.js";
import { PROGRESS_SYNC_V13 } from "./progressSync.v13.js";
import { RECOMMEND_V2 } from "./recommend.v2.js";

/** Every prompt version, so the eval can compare them (pnpm eval --prompt progress-sync@1). */
export const PROMPTS = {
  [PROGRESS_SYNC_V1.version]: PROGRESS_SYNC_V1,
  [PROGRESS_SYNC_V3.version]: PROGRESS_SYNC_V3,
  [PROGRESS_SYNC_V4.version]: PROGRESS_SYNC_V4,
  [PROGRESS_SYNC_V5.version]: PROGRESS_SYNC_V5,
  [PROGRESS_SYNC_V6.version]: PROGRESS_SYNC_V6,
  [PROGRESS_SYNC_V7.version]: PROGRESS_SYNC_V7,
  [PROGRESS_SYNC_V8.version]: PROGRESS_SYNC_V8,
  [PROGRESS_SYNC_V9.version]: PROGRESS_SYNC_V9,
  [PROGRESS_SYNC_V10.version]: PROGRESS_SYNC_V10,
  [PROGRESS_SYNC_V11.version]: PROGRESS_SYNC_V11,
  [PROGRESS_SYNC_V12.version]: PROGRESS_SYNC_V12,
  [PROGRESS_SYNC_V13.version]: PROGRESS_SYNC_V13,
} as const;

/** The prompt the app uses. */
export const CURRENT_PROMPT = PROGRESS_SYNC_V13;

/** The recommendation agent's prompt. */
export const RECOMMEND_PROMPT = RECOMMEND_V2;
