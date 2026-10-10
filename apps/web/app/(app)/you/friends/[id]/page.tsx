import { friendDetailResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Metric, Metrics } from "@/components/Metrics";
import { Poster } from "@/components/Poster";
import { Score } from "@/components/Score";
import { ScreenHeader } from "@/components/ScreenHeader";
import { showHref } from "@/lib/airing";
import { apiGet } from "@/lib/api";
import { addInChat, matchLabel } from "@/lib/friends";

import { ActivityFeed } from "../ActivityFeed";
import { RemoveFriend } from "./RemoveFriend";

export const metadata: Metadata = { title: "Friend · kurisu" };

/** One friend: how your tastes compare, what they loved that you haven't seen, and their week. */
export default async function FriendPage(props: PageProps<"/you/friends/[id]">) {
  const { id } = await props.params;
  const data = await apiGet(`/friends/${encodeURIComponent(id)}`, friendDetailResponseSchema);
  if (!data) redirect("/");
  const { friend } = data;
  const match = matchLabel(friend.match);

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader
        title={friend.malUsername}
        sub={friend.sharing ? "your friend" : "your friend · not sharing activity"}
        back="/you/friends"
      />

      <div className="pt-6">
        <Metrics>
          <Metric
            hero
            label="Taste match"
            value={match.value}
            {...(friend.match.percent !== null && { unit: "%" })}
            basis={match.basis}
          />
        </Metrics>
      </div>

      {data.bothLoved.length > 0 && (
        <ShowList title="You both loved">
          {data.bothLoved.map((show) => (
            <ShowRow key={show.animeId} show={show} detail={`you ${String(show.mine)} · them`}>
              <Score score={show.theirs} />
            </ShowRow>
          ))}
        </ShowList>
      )}

      {data.disagreements.length > 0 && (
        <ShowList title="Where you disagree">
          {data.disagreements.map((show) => (
            <ShowRow key={show.animeId} show={show} detail={`you ${String(show.mine)} · them`}>
              <Score score={show.theirs} />
            </ShowRow>
          ))}
        </ShowList>
      )}

      {data.theyLoved.length > 0 && (
        <ShowList title="They loved, not on your list">
          {data.theyLoved.map((show) => (
            <ShowRow key={show.animeId} show={show} detail="them">
              <Score score={show.theirs} />
              <Link href={addInChat(show.title)} className="k-btn k-btn--sm">
                Add
              </Link>
            </ShowRow>
          ))}
        </ShowList>
      )}

      <section className="pt-6">
        <h2 className="k-caps pb-2">Lately</h2>
        {friend.sharing ? (
          <ActivityFeed items={data.activity} timeZone={data.timeZone} showFriend={false} />
        ) : (
          <p className="k-field__hint">
            {friend.malUsername} doesn&apos;t share what they watch, so only your taste match shows.
          </p>
        )}
      </section>

      <RemoveFriend id={friend.id} name={friend.malUsername} />
    </main>
  );
}

function ShowList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-6">
      <h2 className="k-caps pb-2">{title}</h2>
      <ul className="k-rows">{children}</ul>
    </section>
  );
}

function ShowRow({
  show,
  detail,
  children,
}: {
  show: { animeId: number; title: string; pictureUrl: string | null };
  /** What comes before their score: "you 9 · them". */
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 border-b border-line py-2">
      <Poster url={show.pictureUrl} title={show.title} />
      <Link
        href={showHref(show.animeId)}
        className="k-row__title min-w-0 flex-1 truncate hover:underline"
      >
        {show.title}
      </Link>
      <span className="k-field__hint whitespace-nowrap">{detail}</span>
      {children}
    </li>
  );
}
