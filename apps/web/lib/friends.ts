import type { ActivityItemView, FriendView } from "@kurisu/shared";

/**
 * What a friend did, around the show's title: "watched eps 3–5 of" Frieren, "added" Frieren "to
 * Plan to Watch".
 */
export function activityText(item: ActivityItemView): { lead: string; tail: string } {
  const from = item.fromEpisode;
  const to = item.toEpisode;
  switch (item.kind) {
    case "finished":
      return { lead: "finished", tail: "" };
    case "dropped":
      return { lead: "dropped", tail: "" };
    case "started":
      return { lead: "started", tail: to !== null && to > 1 ? `, eps 1–${String(to)}` : "" };
    case "watched":
      if (from === null || to === null) return { lead: "watched", tail: "" };
      return {
        lead:
          from === to
            ? `watched ep ${String(to)} of`
            : `watched eps ${String(from)}–${String(to)} of`,
        tail: "",
      };
    case "planned":
      return { lead: "added", tail: " to Plan to Watch" };
    case "rated":
      return { lead: "rated", tail: "" };
  }
}

/** The taste match as a metric: its value, and what it rests on. */
export function matchLabel(match: FriendView["match"]): { value: string; basis: string } {
  if (match.percent === null) return { value: "–", basis: "not enough in common yet" };
  const shows = match.sharedScored;
  return {
    value: String(match.percent),
    basis:
      shows === 0
        ? "from the genres you both rate"
        : `from ${String(shows)} ${shows === 1 ? "show" : "shows"} you both scored`,
  };
}

/** A new chat with the add already typed, for the user to send: adds always wait for their OK. */
export function addInChat(title: string): string {
  return `/chat/new?draft=${encodeURIComponent(`Add ${title} to my Plan to Watch`)}`;
}
