/** Formatting for RunMeta and the trace under each reply (the design system's LogEntry). */

const numbers = new Intl.NumberFormat("en");

/** "gemini:gemini-3.5-flash-lite" → "Flash-Lite", "gemini:gemini-3.8-flash" → "Flash". */
export function modelLabel(model: string): string {
  const [provider, ...rest] = model.split(":");
  const id = rest.length > 0 ? rest.join(":") : (provider ?? model);
  if (provider !== "gemini") return id;
  const name = id.replace(/^gemini-[\d.]+-/, "").replace(/-preview.*$/, "");
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("-");
}

/** "2.5s", "0.8s", "30.0s". */
export function secondsLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** "92ms", "1,204ms". */
export function msLabel(ms: number): string {
  return `${numbers.format(ms)}ms`;
}

/** "1,840 tok". */
export function tokensLabel(tokens: number): string {
  return `${numbers.format(tokens)} tok`;
}

/** A failed run's error code in words: "model_timeout" → "timed out". */
export function runErrorLabel(code: string): string {
  switch (code) {
    case "model_timeout":
      return "timed out";
    case "model_rate_limited":
      return "rate limited";
    case "model_auth":
      return "model login failed";
    case "model_unavailable":
      return "model unavailable";
    default:
      return code.replaceAll("_", " ");
  }
}

/** "4 tools", "1 tool". */
export function toolsLabel(count: number): string {
  return `${String(count)} tool${count === 1 ? "" : "s"}`;
}

/** "08:00:12" in the viewer's time zone, 24-hour, as the log's gutter shows it. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-08" in the viewer's time zone. */
function localDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-10-08 08:00" in the viewer's time zone. */
export function dateTime(iso: string): string {
  const date = new Date(iso);
  return `${localDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "21:40" in the viewer's time zone. */
export function hourMinute(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Items by day in the viewer's time zone, keeping their order, each day labelled as the
 * ChangeLog's day rows are: "2026-10-08 Thu".
 */
export function byLocalDay<T>(
  items: T[],
  at: (item: T) => string,
): { key: string; label: string; items: T[] }[] {
  const days = new Map<string, { key: string; label: string; items: T[] }>();
  for (const item of items) {
    const date = new Date(at(item));
    const key = localDate(date);
    const day = days.get(key);
    if (day) day.items.push(item);
    else {
      const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
      days.set(key, { key, label: `${key} ${weekday}`, items: [item] });
    }
  }
  return [...days.values()];
}
