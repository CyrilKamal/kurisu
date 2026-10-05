/**
 * When a daily brief is due. Times are compared on the user's local wall clock, from the IANA
 * time zone their browser reported.
 */

/** A brief later than this after its time is skipped for the day (the server was down). */
export const LATE_LIMIT_MINUTES = 4 * 60;

export interface LocalClock {
  /** "YYYY-MM-DD" in the user's time zone. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year ?? ""}-${parts.month ?? ""}-${parts.day ?? ""}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** "08:30" → 510. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export type BriefTiming =
  { due: false } | { due: true; localDate: string; late: boolean; minutesLate: number };

/**
 * Whether today's brief is due: the user's brief time has passed on their local clock. `late`
 * means it passed more than LATE_LIMIT_MINUTES ago. A day's brief happens at most once; the
 * caller checks that.
 */
export function briefTiming(
  settings: { localTime: string; timeZone: string },
  now: Date,
): BriefTiming {
  const clock = localClock(now, settings.timeZone);
  const minutesLate = clock.minutes - minutesOf(settings.localTime);
  if (minutesLate < 0) return { due: false };
  return { due: true, localDate: clock.date, late: minutesLate > LATE_LIMIT_MINUTES, minutesLate };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
