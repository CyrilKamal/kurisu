import { mkdirSync, writeFileSync } from "node:fs";

import { stringify } from "yaml";

import type { reviewItems } from "../../src/db/schema.js";
import { airingFreezeSchema } from "./airing.js";
import { snapshotSchema } from "./snapshot.js";

type ReviewItem = typeof reviewItems.$inferSelect;

/**
 * A review item as eval files: its list as a snapshot named review-<id start>, its shows'
 * airing then, and a draft case with the message and history and an empty `expect` for the
 * owner to label. Nothing here is labeled: the expected writes are the owner's call.
 */
export function reviewDraft(item: ReviewItem) {
  const name = `review-${item.id.slice(0, 8)}`;
  const snapshot = snapshotSchema.parse({
    name,
    description: `The list before the run of review item ${item.id} (${item.kind}), from the hosted app. Private: never commit.`,
    source: "mal-mirror",
    exportedAt: item.createdAt.toISOString(),
    entries: item.listSnapshot,
  });
  const airing = airingFreezeSchema.parse({
    description: `AniList's newest episodes for ${name}'s airing shows when it was captured.`,
    source: "anilist",
    frozenAt: item.createdAt.toISOString(),
    shows: item.airing,
  });
  const draft = {
    snapshot: name,
    cases: [
      {
        id: name,
        message: item.message,
        ...(item.history.length > 0 && { history: item.history }),
        tags: ["review", item.kind],
        notes: `From the review queue (${item.kind}${item.note ? `: ${item.note}` : ""}). kurisu replied: ${item.reply}`,
        expect: {},
      },
    ],
  };
  const yaml = [
    "# Exported from the review queue. Label it: fill in expect (writes, adds, clarify: true,",
    '# or writes: [] for "do nothing"; see ../../README.md), then move this file up into',
    "# eval/private/ and run it with: pnpm eval --dir private",
    stringify(draft, { lineWidth: 100 }),
  ].join("\n");
  return { name, snapshot, airing, yaml };
}

/** Writes a review item's draft case and its snapshot files. */
export function writeReviewDraft(
  item: ReviewItem,
  dirs: { drafts: string; snapshots: string },
): ReturnType<typeof reviewDraft> {
  const files = reviewDraft(item);
  mkdirSync(dirs.snapshots, { recursive: true });
  mkdirSync(dirs.drafts, { recursive: true });
  writeFileSync(
    `${dirs.snapshots}${files.name}.json`,
    `${JSON.stringify(files.snapshot, null, 2)}\n`,
  );
  writeFileSync(
    `${dirs.snapshots}${files.name}.airing.json`,
    `${JSON.stringify(files.airing, null, 2)}\n`,
  );
  writeFileSync(`${dirs.drafts}${files.name}.yaml`, files.yaml);
  return files;
}
