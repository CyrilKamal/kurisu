import type { SyncRun } from "./listSync.js";

/** The last sync, as the web app sees it. */
export interface LastSync {
  status: SyncRun["status"];
  trigger: SyncRun["trigger"];
  startedAt: string;
  finishedAt: string | null;
  entriesCount: number | null;
  error: string | null;
}

export function toLastSync(run: SyncRun | null): LastSync | null {
  if (!run) return null;
  return {
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    entriesCount: run.entriesCount,
    error: run.error,
  };
}
