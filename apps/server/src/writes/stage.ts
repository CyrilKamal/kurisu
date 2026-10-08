import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { proposals } from "../db/schema.js";
import type { ListChange, ListState } from "./normalize.js";
import type { Proposal } from "./propose.js";

/**
 * Stages a proposal the user already decided on (an edit on the List screen, or a row of an
 * import they tapped Import for), for commitProposal to write. The idempotency key makes a retry
 * return the same proposal, so it's written once.
 */
export async function stageProposal(
  db: Db,
  values: {
    userId: string;
    animeId: number;
    source: "user" | "import";
    kind: "update" | "add" | "remove";
    idempotencyKey: string;
    /** The entry as it stands; null for an add. */
    before: ListState | null;
    change: ListChange;
  },
): Promise<Proposal> {
  await db
    .insert(proposals)
    .values({
      userId: values.userId,
      animeId: values.animeId,
      source: values.source,
      kind: values.kind,
      idempotencyKey: values.idempotencyKey,
      before: values.before,
      change: values.change,
    })
    .onConflictDoNothing({ target: [proposals.userId, proposals.idempotencyKey] });
  return findProposal(db, values.userId, values.idempotencyKey).then((proposal) => {
    if (!proposal) throw new Error("proposal insert returned no row");
    return proposal;
  });
}

/** The proposal staged under a key, if any. */
export async function findProposal(
  db: Db,
  userId: string,
  idempotencyKey: string,
): Promise<Proposal | null> {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.userId, userId), eq(proposals.idempotencyKey, idempotencyKey)))
    .limit(1);
  return proposal ?? null;
}
