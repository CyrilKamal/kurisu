// A small iCalendar (RFC 5545) writer for the calendar feed: one calendar of timed events, in
// UTC. Hand-written, since the feed needs only these few properties.

const CRLF = "\r\n";
/** A content line's most octets before it folds (RFC 5545 3.1). */
const LINE_OCTETS = 75;

export interface CalendarEvent {
  /** Stable across fetches, so calendar apps update an event instead of adding a new one. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  url?: string;
}

/** Escapes a TEXT value: backslashes, semicolons, commas and line breaks (RFC 5545 3.3.11). */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Folds a content line into lines of at most 75 octets, each continuation starting with a space,
 * never splitting a character.
 */
export function foldLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    // A continuation's leading space counts toward its 75.
    const limit = lines.length === 0 ? LINE_OCTETS : LINE_OCTETS - 1;
    if (octets + size > limit) {
      lines.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  lines.push(current);
  return lines.join(`${CRLF} `);
}

/** A UTC date-time: 20261019T153000Z. */
export function icsDateTime(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

/**
 * A whole calendar. `refresh` is how often calendar apps should fetch it again, as a duration
 * ("PT6H"). Events are transparent, so episodes never make the reader look busy.
 */
export function icsCalendar(input: {
  name: string;
  description: string;
  refresh: string;
  events: CalendarEvent[];
  now: Date;
}): string {
  const stamp = icsDateTime(input.now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//kurisu//calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.name)}`,
    `X-WR-CALDESC:${escapeText(input.description)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${input.refresh}`,
    `X-PUBLISHED-TTL:${input.refresh}`,
  ];
  for (const event of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(event.start)}`,
      `DTEND:${icsDateTime(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
