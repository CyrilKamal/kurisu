import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, or } from "drizzle-orm";

import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db, Executor } from "../db/client.js";
import { friendLinks, friendships, users } from "../db/schema.js";

export interface Friend {
  id: string;
  malUsername: string;
  since: Date;
  /** Whether they let friends see what they watch. */
  shareActivity: boolean;
}

/** A friendship is stored once, smaller id first (as Postgres orders uuids). */
function pair(a: string, b: string): { userA: string; userB: string } {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

/** Makes two users friends; nothing happens if they already are. */
export async function addFriendship(
  db: Executor,
  a: string,
  b: string,
  via: "invite" | "link",
): Promise<void> {
  if (a === b) return;
  await db
    .insert(friendships)
    .values({ ...pair(a, b), via })
    .onConflictDoNothing();
}

export async function removeFriendship(db: Db, a: string, b: string): Promise<boolean> {
  const { userA, userB } = pair(a, b);
  const removed = await db
    .delete(friendships)
    .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
    .returning({ userA: friendships.userA });
  return removed.length > 0;
}

export async function listFriends(db: Db, userId: string): Promise<Friend[]> {
  const rows = await db
    .select({
      id: users.id,
      malUsername: users.malUsername,
      since: friendships.createdAt,
      shareActivity: users.shareActivity,
    })
    .from(friendships)
    .innerJoin(
      users,
      or(
        and(eq(friendships.userA, userId), eq(users.id, friendships.userB)),
        and(eq(friendships.userB, userId), eq(users.id, friendships.userA)),
      ),
    )
    .where(or(eq(friendships.userA, userId), eq(friendships.userB, userId)))
    .orderBy(asc(users.malUsername));
  return rows;
}

/** One friend of the user, or null when they aren't friends: every friend view checks this. */
export async function findFriend(db: Db, userId: string, friendId: string): Promise<Friend | null> {
  if (userId === friendId) return null;
  const friends = await listFriends(db, userId);
  return friends.find((friend) => friend.id === friendId) ?? null;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

const linkContext = (userId: string) => `friend_link:${userId}`;

/**
 * The user's friend link code, made the first time it's asked for. It's kept encrypted, so it can
 * be shown again, and hashed, so an opened link can be looked up.
 */
export async function friendLinkCode(
  db: Db,
  cipher: TokenCipher,
  userId: string,
  options: { reset?: boolean } = {},
): Promise<string> {
  if (!options.reset) {
    const [existing] = await db
      .select({ codeEnc: friendLinks.codeEnc })
      .from(friendLinks)
      .where(eq(friendLinks.userId, userId));
    if (existing) return cipher.decrypt(existing.codeEnc, linkContext(userId));
  }
  const code = randomBytes(24).toString("base64url");
  const row = {
    userId,
    codeHash: hashCode(code),
    codeEnc: cipher.encrypt(code, linkContext(userId)),
    createdAt: new Date(),
  };
  await db
    .insert(friendLinks)
    .values(row)
    .onConflictDoUpdate({ target: friendLinks.userId, set: row });
  return code;
}

/** Whose friend link this is. */
export async function findLinkOwner(
  db: Db,
  code: string,
): Promise<{ id: string; malUsername: string } | null> {
  const [row] = await db
    .select({ id: users.id, malUsername: users.malUsername })
    .from(friendLinks)
    .innerJoin(users, eq(users.id, friendLinks.userId))
    .where(eq(friendLinks.codeHash, hashCode(code)));
  return row ?? null;
}
