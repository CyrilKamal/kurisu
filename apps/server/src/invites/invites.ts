import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db, Executor } from "../db/client.js";
import { invites, users } from "../db/schema.js";

/** An invite link works for a week, and only once. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The invites the owner sees: the latest, used or not. */
const LISTED_INVITES = 20;

export type InviteStatus = "open" | "used" | "expired";

export interface InviteView {
  id: string;
  note: string | null;
  createdAt: Date;
  expiresAt: Date;
  status: InviteStatus;
  /** The MAL username of whoever joined with it. */
  usedBy: string | null;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Creates an invite and returns its code, which only the link carries; the DB keeps its hash. */
export async function createInvite(
  db: Db,
  createdBy: string,
  note: string | null,
): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [row] = await db
    .insert(invites)
    .values({ codeHash: hashCode(code), createdBy, note, expiresAt })
    .returning({ id: invites.id });
  if (!row) throw new Error("invite insert returned no row");
  return { id: row.id, code, expiresAt };
}

export async function listInvites(db: Db, createdBy: string, now = new Date()) {
  const joined = alias(users, "joined");
  const rows = await db
    .select({
      id: invites.id,
      note: invites.note,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      usedBy: joined.malUsername,
    })
    .from(invites)
    .leftJoin(joined, eq(invites.usedBy, joined.id))
    .where(eq(invites.createdBy, createdBy))
    .orderBy(desc(invites.createdAt))
    .limit(LISTED_INVITES);
  return rows.map((row): InviteView => ({
    id: row.id,
    note: row.note,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: row.usedAt !== null ? "used" : row.expiresAt <= now ? "expired" : "open",
    usedBy: row.usedBy,
  }));
}

/** Deletes an invite nobody has used yet, so its link stops working. */
export async function revokeInvite(db: Db, createdBy: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(invites)
    .where(and(eq(invites.id, id), eq(invites.createdBy, createdBy), isNull(invites.usedAt)))
    .returning({ id: invites.id });
  return deleted.length > 0;
}

/** The invite behind a code, while it can still be used, with who sent it. */
export async function findOpenInvite(
  db: Db,
  code: string,
): Promise<{ id: string; inviter: string } | null> {
  const [row] = await db
    .select({ id: invites.id, inviter: users.malUsername })
    .from(invites)
    .innerJoin(users, eq(invites.createdBy, users.id))
    .where(
      and(
        eq(invites.codeHash, hashCode(code)),
        isNull(invites.usedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Uses up an invite for a new account, returning who sent it. A single conditional UPDATE, so two
 * sign-ups racing on one link can't both get in. Returns null if it was used, revoked or expired
 * meanwhile.
 */
export async function useInvite(
  db: Executor,
  inviteId: string,
  userId: string,
): Promise<string | null> {
  const used = await db
    .update(invites)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(and(eq(invites.id, inviteId), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
    .returning({ inviter: invites.createdBy });
  return used[0]?.inviter ?? null;
}
