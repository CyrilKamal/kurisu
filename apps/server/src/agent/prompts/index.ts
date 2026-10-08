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
import { PROGRESS_SYNC_V14 } from "./progressSync.v14.js";
import { RECOMMEND_V1 } from "./recommend.v1.js";
import { RECOMMEND_V2 } from "./recommend.v2.js";
import { RECOMMEND_V3 } from "./recommend.v3.js";
import { RECOMMEND_V4 } from "./recommend.v4.js";
import { RECOMMEND_V5 } from "./recommend.v5.js";
import { RECOMMEND_V6 } from "./recommend.v6.js";
import { RECOMMEND_V7 } from "./recommend.v7.js";

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
  [PROGRESS_SYNC_V14.version]: PROGRESS_SYNC_V14,
} as const;

/** The prompt the app uses. */
export const CURRENT_PROMPT = PROGRESS_SYNC_V13;

/** The recommendation agent's prompt. */
export const RECOMMEND_PROMPT = RECOMMEND_V7;

/** Every recommendation prompt by version, for comparing them in the recommendation eval. */
export const RECOMMEND_PROMPTS = {
  [RECOMMEND_V1.version]: RECOMMEND_V1,
  [RECOMMEND_V2.version]: RECOMMEND_V2,
  [RECOMMEND_V3.version]: RECOMMEND_V3,
  [RECOMMEND_V4.version]: RECOMMEND_V4,
  [RECOMMEND_V5.version]: RECOMMEND_V5,
  [RECOMMEND_V6.version]: RECOMMEND_V6,
  [RECOMMEND_V7.version]: RECOMMEND_V7,
} as const;
