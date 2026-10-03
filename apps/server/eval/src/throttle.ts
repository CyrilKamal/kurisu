import type { ModelClient } from "../../src/llm/modelClient.js";
import { ModelProviderError } from "../../src/llm/types.js";

export interface ThrottledModels extends ModelClient {
  /** Total time spent waiting, so the eval can leave it out of latency. */
  waitedMs: number;
}

const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 20_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * For eval runs on free tiers with per-minute limits: spaces model calls to at most perMinute,
 * and when the provider says "rate limited" or "busy" (a 503 under high demand), waits and
 * retries a few times instead of failing the case: those say nothing about the agent. Only the
 * eval uses this; the app makes one user's calls as they come.
 */
export function throttle(
  inner: ModelClient,
  perMinute: number,
  wait: (ms: number) => Promise<void> = sleep,
): ThrottledModels {
  const gapMs = 60_000 / perMinute;
  let nextAt = 0;
  const client: ThrottledModels = {
    waitedMs: 0,
    async chat(ref, request) {
      for (let attempt = 0; ; attempt++) {
        const now = Date.now();
        const delay = Math.max(0, nextAt - now);
        if (delay > 0) {
          await wait(delay);
          client.waitedMs += delay;
        }
        nextAt = Math.max(now, nextAt) + gapMs;
        try {
          return await inner.chat(ref, request);
        } catch (err) {
          const transient =
            err instanceof ModelProviderError &&
            (err.kind === "rate_limited" || err.kind === "unavailable");
          if (!transient || attempt >= RATE_LIMIT_RETRIES) throw err;
          const backoff = RATE_LIMIT_BACKOFF_MS * (attempt + 1);
          console.warn(`  ${err.kind}; waiting ${String(backoff / 1000)} s and retrying`);
          await wait(backoff);
          client.waitedMs += backoff;
        }
      }
    },
  };
  return client;
}
