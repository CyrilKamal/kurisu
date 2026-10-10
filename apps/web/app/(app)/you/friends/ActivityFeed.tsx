import type { ActivityItemView } from "@kurisu/shared";
import { Fragment } from "react";
import Link from "next/link";

import { Poster } from "@/components/Poster";
import { Score } from "@/components/Score";
import { showHref } from "@/lib/airing";
import { groupByDay } from "@/lib/diary";
import { activityText } from "@/lib/friends";

/**
 * What friends watched, by day on the viewer's clock, laid out like the ChangeLog: the time, the
 * poster, who did what, a score when they gave one, and a note they chose to share.
 */
export function ActivityFeed({
  items,
  timeZone,
  showFriend = true,
}: {
  items: ActivityItemView[];
  timeZone: string;
  /** Off on one friend's own page, where every line is theirs. */
  showFriend?: boolean;
}) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (items.length === 0) {
    return (
      <div className="k-empty mt-2">
        <p className="k-empty__title">Nothing yet</p>
        <p className="k-empty__text">
          When friends who share their activity watch, finish or score something, it shows up here.
        </p>
      </div>
    );
  }

  return (
    <ol className="k-changes -mx-4">
      {groupByDay(items, timeZone).map((day) => (
        <Fragment key={day.date}>
          <li className="k-changes__day">
            <span>
              {day.date} · {day.label}
            </span>
            <span />
          </li>
          {day.entries.map((item) => (
            <li
              key={`${item.friendId}:${String(item.animeId)}:${item.at}`}
              className="k-changes__entry"
            >
              <time className="k-changes__time" dateTime={item.at}>
                {time.format(new Date(item.at))}
              </time>
              <Poster url={item.pictureUrl} title={item.title} />
              <div className="min-w-0">
                <p className="text-ink">
                  {showFriend && <span className="font-semibold">{item.friend} </span>}
                  <span className="text-ink-muted">{activityText(item).lead} </span>
                  <Link href={showHref(item.animeId)} className="k-write__title hover:underline">
                    {item.title}
                  </Link>
                  <span className="text-ink-muted">{activityText(item).tail}</span>
                </p>
                {item.note && <p className="k-drop__said">{item.note}</p>}
              </div>
              {item.score !== null ? <Score score={item.score} /> : <span />}
            </li>
          ))}
        </Fragment>
      ))}
    </ol>
  );
}
