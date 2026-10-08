import type { DiaryEntry } from "@kurisu/shared";

export interface DiaryDay {
  /** "2026-10-08" on the user's clock. */
  date: string;
  /** "Today", "Yesterday", or "Mon, Oct 6". */
  label: string;
  entries: DiaryEntry[];
}

/** The date on the user's clock, "2026-10-08". */
function dateIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The diary's entries by day on the user's clock, newest first, keeping their order within. */
export function groupByDay(
  entries: DiaryEntry[],
  timeZone: string,
  now: Date = new Date(),
): DiaryDay[] {
  const today = dateIn(now, timeZone);
  const yesterday = dateIn(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone);
  const days = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const date = dateIn(new Date(entry.at), timeZone);
    days.set(date, [...(days.get(date) ?? []), entry]);
  }
  return [...days].map(([date, dayEntries]) => ({
    date,
    label:
      date === today
        ? "Today"
        : date === yesterday
          ? "Yesterday"
          : new Intl.DateTimeFormat("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${date}T12:00:00Z`)),
    entries: dayEntries,
  }));
}
