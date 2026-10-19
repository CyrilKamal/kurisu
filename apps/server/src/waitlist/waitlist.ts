import { createHash, randomBytes } from "node:crypto";

import { count, desc, eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { waitlist } from "../db/schema.js";
import { createInvite } from "../invites/invites.js";

/** The most entries the waitlist holds, so a flood can't fill the database. */
export const WAITLIST_MAX_ENTRIES = 10_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type JoinResult =
  | { status: "joined"; leaveToken: string }
  /** Already on the list. No token: whoever typed the address may not own it. */
  | { status: "already" }
  | { status: "full" };

/** Puts someone on the waitlist, once per email address. */
export async function joinWaitlist(
  db: Db,
  input: { email: string; malUsername: string | null },
): Promise<JoinResult> {
  const email = normalizeEmail(input.email);
  const [{ entries } = { entries: 0 }] = await db.select({ entries: count() }).from(waitlist);
  if (entries >= WAITLIST_MAX_ENTRIES) return { status: "full" };

  const leaveToken = randomBytes(24).toString("base64url");
  const inserted = await db
    .insert(waitlist)
    .values({ email, malUsername: input.malUsername, leaveTokenHash: hashToken(leaveToken) })
    .onConflictDoNothing({ target: waitlist.email })
    .returning({ id: waitlist.id });
  return inserted.length > 0 ? { status: "joined", leaveToken } : { status: "already" };
}

/** Takes an entry off the list by the token its person was shown. Unknown tokens do nothing. */
export async function leaveWaitlist(db: Db, token: string): Promise<boolean> {
  const removed = await db
    .delete(waitlist)
    .where(eq(waitlist.leaveTokenHash, hashToken(token)))
    .returning({ id: waitlist.id });
  return removed.length > 0;
}

/** The whole list for the owner, newest first. */
export async function listWaitlist(db: Db) {
  return db
    .select({
      id: waitlist.id,
      email: waitlist.email,
      malUsername: waitlist.malUsername,
      createdAt: waitlist.createdAt,
      invitedAt: waitlist.invitedAt,
    })
    .from(waitlist)
    .orderBy(desc(waitlist.createdAt));
}

/**
 * Makes an invite link for an entry (its note is the person's email) and marks the entry
 * invited. Inviting again makes a new link: the old one may have expired.
 */
export async function inviteFromWaitlist(
  db: Db,
  ownerId: string,
  id: string,
): Promise<{ code: string; expiresAt: Date } | null> {
  const [entry] = await db
    .select({ email: waitlist.email })
    .from(waitlist)
    .where(eq(waitlist.id, id));
  if (!entry) return null;
  // Notes are capped at 60 characters, like the Friends screen's.
  const invite = await createInvite(db, ownerId, entry.email.slice(0, 60));
  await db
    .update(waitlist)
    .set({ invitedAt: new Date(), inviteId: invite.id })
    .where(eq(waitlist.id, id));
  return { code: invite.code, expiresAt: invite.expiresAt };
}

export async function removeFromWaitlist(db: Db, id: string): Promise<boolean> {
  const removed = await db
    .delete(waitlist)
    .where(eq(waitlist.id, id))
    .returning({ id: waitlist.id });
  return removed.length > 0;
}
