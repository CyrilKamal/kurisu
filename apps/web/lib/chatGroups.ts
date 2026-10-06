import type { ConversationView } from "@kurisu/shared";

const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;
export type ChatGroupLabel = (typeof GROUPS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar days from one date to a later one, in the viewer's time zone: 0 on the same day. */
function daysBetween(earlier: Date, later: Date): number {
  const start = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const end = new Date(later.getFullYear(), later.getMonth(), later.getDate());
  // Rounded, since a day with a daylight saving change is 23 or 25 hours long.
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/** Chats grouped by when they were last active, keeping their order within each group. */
export function groupChats(
  chats: ConversationView[],
  now: Date,
): { label: ChatGroupLabel; chats: ConversationView[] }[] {
  const byLabel = new Map<ChatGroupLabel, ConversationView[]>();
  for (const chat of chats) {
    const days = daysBetween(new Date(chat.lastMessageAt), now);
    const label: ChatGroupLabel =
      days <= 0 ? "Today" : days === 1 ? "Yesterday" : days <= 7 ? "Previous 7 days" : "Older";
    byLabel.set(label, [...(byLabel.get(label) ?? []), chat]);
  }
  return GROUPS.flatMap((label) => {
    const group = byLabel.get(label);
    return group ? [{ label, chats: group }] : [];
  });
}
