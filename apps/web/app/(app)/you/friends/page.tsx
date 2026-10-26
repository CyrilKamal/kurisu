import {
  friendsResponseSchema,
  invitesResponseSchema,
  waitlistResponseSchema,
} from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ShareLink } from "@/components/ShareLink";
import { SupporterBadge } from "@/components/SupporterBadge";
import { apiGet, getMe } from "@/lib/api";
import { matchLabel } from "@/lib/friends";

import { ActivityFeed } from "./ActivityFeed";
import { FriendLink } from "./FriendLink";
import { InviteFriends } from "./InviteFriends";
import { Waitlist } from "./Waitlist";

export const metadata: Metadata = { title: "Friends · kurisu" };

/**
 * Your friends with your taste match, what they watched lately, your friend link and sharing;
 * for the owner, invites too.
 */
export default async function FriendsPage() {
  const [me, data] = await Promise.all([getMe(), apiGet("/friends", friendsResponseSchema)]);
  if (!me || !data) redirect("/");
  const invites = me.user.isOwner ? await apiGet("/invites", invitesResponseSchema) : null;
  const waitlist = me.user.isOwner ? await apiGet("/waitlist", waitlistResponseSchema) : null;

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader
        title="Friends"
        sub={`${String(data.friends.length)} ${data.friends.length === 1 ? "friend" : "friends"}`}
        back="/you"
      />

      <section className="pt-6">
        <h2 className="k-title pb-2">Your friends</h2>
        {data.friends.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="k-field__hint">
              No friends yet. Send your link to friends on kurisu: opening it makes you friends.
            </p>
            <ShareLink url={data.link} text="Add me on kurisu" label="Share my link" />
          </div>
        ) : (
          <ul className="k-rows">
            {data.friends.map((friend) => {
              const match = matchLabel(friend.match);
              return (
                <li key={friend.id}>
                  <Link
                    href={`/you/friends/${friend.id}`}
                    className="flex items-center justify-between gap-4 border-b border-line py-2 hover:bg-surface"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-ink">{friend.malUsername}</span>
                        <SupporterBadge plan={friend.supporter} />
                      </span>
                      <span className="k-field__hint">
                        {match.basis}
                        {friend.sharing ? "" : " · not sharing activity"}
                      </span>
                    </span>
                    <span className="k-num text-ink">
                      {match.value}
                      {friend.match.percent !== null && (
                        <span className="text-ink-muted">% match</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="pt-6">
        <h2 className="k-title pb-2">Lately</h2>
        <ActivityFeed items={data.activity} timeZone={data.timeZone} />
      </section>

      <FriendLink initialLink={data.link} />

      {invites && (
        <>
          <p className="k-field__hint pt-6">
            kurisu is invite-only. Each invite lets one person join with their MyAnimeList account,
            works for a week, and makes you friends.
          </p>
          <InviteFriends initial={invites.invites} />
        </>
      )}
      {waitlist && <Waitlist initial={waitlist.entries} />}
    </main>
  );
}
