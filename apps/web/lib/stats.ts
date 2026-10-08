/** Formatting for the Stats page. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Minutes as days, to one decimal: "12.4". */
export function daysWatched(minutes: number): string {
  return (minutes / (60 * 24)).toFixed(1);
}

/** Minutes as hours, to one decimal below 10 and whole above: "4.5", "23". */
export function hoursWatched(minutes: number): string {
  const hours = minutes / 60;
  return hours < 10 ? hours.toFixed(1) : String(Math.round(hours));
}

/** "Jan" for 1. */
export function monthLabel(month: number): string {
  return MONTHS[month - 1] ?? "";
}

/** MAL's "2026-03-14", "2026-03" or "2026" as "Mar 14", "Mar" or "2026". */
export function shortDate(date: string): string {
  const [year, month, day] = date.split("-");
  const name = month ? monthLabel(Number(month)) : "";
  if (!name) return year ?? date;
  return day ? `${name} ${String(Number(day))}` : name;
}

export interface GoalProgress {
  /** 0–100, capped at 100. */
  percent: number;
  label: string;
}

/** How far along this year's goal is: "12 of 40 shows", "Goal met: 41 of 40". */
export function goalProgress(completed: number, goal: number): GoalProgress {
  const percent = Math.min(100, Math.round((completed / goal) * 100));
  const shows = goal === 1 ? "show" : "shows";
  return {
    percent,
    label:
      completed >= goal
        ? `Goal met: ${String(completed)} of ${String(goal)} ${shows}`
        : `${String(completed)} of ${String(goal)} ${shows}`,
  };
}

/** "1 show", "3 shows". */
export function showCount(n: number): string {
  return `${String(n)} ${n === 1 ? "show" : "shows"}`;
}
