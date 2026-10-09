import {
  friendLinkAcceptSchema,
  sharingRequestSchema,
  type ActivityItemView,
  type FriendView,
} from "@kurisu/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { TokenCipher } from "../crypto/tokenCipher.js";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import { userTimeZone } from "../stats/compute.js";
import { friendActivity, type ActivityItem } from "./activity.js";
import {
  addFriendship,
  findFriend,
  findLinkOwner,
  friendLinkCode,
  listFriends,
  removeFriendship,
  type Friend,
} from "./friendships.js";
import { tasteMatch } from "./match.js";

export interface FriendRouteDeps {
  config: Config;
  db: Db;
  cipher: TokenCipher;
}

/** Items in the Friends feed, and on one friend's page. */
const FEED_LENGTH = 50;
const FRIEND_FEED_LENGTH = 30;

const idParams = z.object({ id: z.uuid() });
const codeParams = z.object({ code: z.string().min(1).max(128) });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

export function registerFriendRoutes(app: FastifyInstance, deps: FriendRouteDeps): void {
  const { config, db, cipher } = deps;
  const read = { preHandler: requireUser(db) };
  const write = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };
  const linkUrl = (code: string) => `${config.webOrigin}/friend/${code}`;

  const view = async (userId: string, friend: Friend): Promise<FriendView> => {
    const match = await tasteMatch(db, userId, friend.id);
    return {
      id: friend.id,
      malUsername: friend.malUsername,
      since: friend.since.toISOString(),
      sharing: friend.shareActivity,
      match: { percent: match.percent, sharedScored: match.sharedScored },
    };
  };

  /** The Friends screen: your link, your friends with their taste match, and what they watched. */
  app.get("/friends", read, async (request) => {
    const userId = userOf(request);
    const friends = await listFriends(db, userId);
    const [me] = await db
      .select({ shareActivity: users.shareActivity })
      .from(users)
      .where(eq(users.id, userId));
    return {
      timeZone: await userTimeZone(db, userId),
      link: linkUrl(await friendLinkCode(db, cipher, userId)),
      shareActivity: me?.shareActivity ?? true,
      friends: await Promise.all(friends.map((friend) => view(userId, friend))),
      activity: (await friendActivity(db, friends, FEED_LENGTH)).map(activityJson),
    };
  });

  /** One friend: the taste match in full and their activity, if they share it. */
  app.get("/friends/:id", read, async (request, reply) => {
    const userId = userOf(request);
    const params = idParams.safeParse(request.params);
    const friend = params.success ? await findFriend(db, userId, params.data.id) : null;
    if (!friend) return reply.code(404).send({ error: "not_found" });
    const match = await tasteMatch(db, userId, friend.id);
    const sharing = friend.shareActivity;
    return {
      timeZone: await userTimeZone(db, userId),
      friend: await view(userId, friend),
      // With sharing off, only the match itself: no shows, no scores.
      bothLoved: sharing ? match.bothLoved : [],
      disagreements: sharing ? match.disagreements : [],
      theyLoved: sharing ? match.theyLoved : [],
      activity: (await friendActivity(db, [friend], FRIEND_FEED_LENGTH)).map(activityJson),
    };
  });

  app.delete("/friends/:id", write, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const removed = params.success && (await removeFriendship(db, userOf(request), params.data.id));
    if (!removed) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  /** A new friend link; the old one stops working. */
  app.post("/friends/link/reset", write, async (request) => ({
    link: linkUrl(await friendLinkCode(db, cipher, userOf(request), { reset: true })),
  }));

  /** For the page a friend link opens: whose it is, and whether you're friends already. */
  app.get("/friends/links/:code", read, async (request, reply) => {
    const userId = userOf(request);
    const params = codeParams.safeParse(request.params);
    const owner = params.success ? await findLinkOwner(db, params.data.code) : null;
    if (!owner) return reply.code(404).send({ error: "not_found" });
    return {
      owner: owner.malUsername,
      self: owner.id === userId,
      alreadyFriends: owner.id !== userId && (await findFriend(db, userId, owner.id)) !== null,
    };
  });

  /** Opening someone's friend link and tapping Add makes you friends. */
  app.post("/friends", write, async (request, reply) => {
    const userId = userOf(request);
    const body = friendLinkAcceptSchema.safeParse(request.body);
    const owner = body.success ? await findLinkOwner(db, body.data.code) : null;
    if (!owner) return reply.code(404).send({ error: "not_found" });
    if (owner.id === userId) return reply.code(400).send({ error: "own_link" });
    await addFriendship(db, userId, owner.id, "link");
    return reply.code(201).send({ friendId: owner.id });
  });

  /** Whether friends see what you watch. */
  app.put("/friends/sharing", write, async (request, reply) => {
    const body = sharingRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    await db
      .update(users)
      .set({ shareActivity: body.data.shareActivity, updatedAt: new Date() })
      .where(eq(users.id, userOf(request)));
    return { shareActivity: body.data.shareActivity };
  });
}

function activityJson(item: ActivityItem): ActivityItemView {
  return { ...item, at: item.at.toISOString() };
}
