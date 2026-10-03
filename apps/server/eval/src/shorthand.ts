/**
 * The shorthand case format: one case per line in a .txt file in eval/cases/, about as quick to
 * type as the message itself. loadCases reads these alongside the YAML files.
 *
 *   snapshot: my-list                          optional; my-list by default
 *   tags: plain                                tags for every case below it ("tags:" clears)
 *   // a comment
 *   <message> => <what should happen>  #tag #tag  // optional note
 *
 * What should happen, after "=>":
 *   none                                       no write and no question
 *   ask                                        a question (or a held change) instead of a write
 *   <title or MAL id>: <fields>                a write; separate several with ";", and add "; ask"
 *                                              when part of the message should get a question
 * Fields, separated by commas: ep N, score N, rewatching, not rewatching, or a status
 * (watching, completed, on hold, dropped, plan to watch / ptw).
 *
 * Earlier turns go on the lines right above their case, as "user: ..." and "bot: ...".
 */

type Role = "user" | "assistant";

export interface ShorthandWrite {
  anime: string | number;
  status?: string;
  episodes_watched?: number;
  score?: number;
  is_rewatching?: boolean;
}

/** The same shape as a case in a YAML file, before schema validation. */
export interface ShorthandCase {
  id: string;
  message: string;
  history: { role: Role; content: string }[];
  tags: string[];
  notes?: string;
  expect: { writes: ShorthandWrite[]; clarify: boolean };
}

export interface ShorthandFile {
  snapshot: string;
  cases: ShorthandCase[];
  /** Line number of each case, by id. */
  lineOf: Map<string, number>;
  errors: { line: number; message: string }[];
}

const STATUSES: Record<string, string> = {
  watching: "watching",
  completed: "completed",
  "on hold": "on_hold",
  dropped: "dropped",
  "plan to watch": "plan_to_watch",
  ptw: "plan_to_watch",
};

export function parseShorthand(text: string, fileStem: string): ShorthandFile {
  const out: ShorthandFile = { snapshot: "my-list", cases: [], lineOf: new Map(), errors: [] };
  const stem = slug(fileStem) || "cases";
  let defaultTags: string[] = [];
  let history: { role: Role; content: string }[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trim();
    const fail = (message: string) => out.errors.push({ line, message });

    if (content === "") {
      history = [];
      return;
    }
    if (content.startsWith("//")) return;

    const directive = /^(snapshot|tags):\s*(.*)$/i.exec(content);
    if (directive && !content.includes("=>")) {
      const value = directive[2] ?? "";
      if (directive[1]?.toLowerCase() === "snapshot") out.snapshot = value.trim();
      else
        defaultTags = value
          .split(/[\s,#]+/)
          .filter(Boolean)
          .map((t) => t.toLowerCase());
      return;
    }

    const turn = /^(user|bot):\s*(.+)$/i.exec(content);
    if (turn && !content.includes("=>")) {
      const role: Role = turn[1]?.toLowerCase() === "user" ? "user" : "assistant";
      history.push({ role, content: turn[2] ?? "" });
      return;
    }

    const arrow = content.indexOf("=>");
    if (arrow < 0) {
      fail('expected "<message> => <what should happen>" (or a "user:" / "bot:" turn).');
      history = [];
      return;
    }
    const message = content.slice(0, arrow).trim();
    let rest = content.slice(arrow + 2);

    let notes: string | undefined;
    const noteAt = rest.indexOf("//");
    if (noteAt >= 0) {
      notes = rest.slice(noteAt + 2).trim() || undefined;
      rest = rest.slice(0, noteAt);
    }
    // Tags only at the end, so titles like "Kaiju #8" stay intact.
    const tags = [...defaultTags];
    const trailing = /(?:\s+#[a-z0-9-]+)+\s*$/i.exec(` ${rest}`);
    if (trailing) {
      for (const tag of trailing[0].trim().split(/\s+/)) tags.push(tag.slice(1).toLowerCase());
      rest = ` ${rest}`.slice(0, trailing.index);
    }

    const parsed = parseExpectation(rest);
    if (!message) parsed.errors.unshift('the message before "=>" is empty.');
    if (parsed.errors.length > 0) {
      for (const problem of parsed.errors) fail(problem);
      history = [];
      return;
    }

    const id = uniqueId(`${stem}-${slug(message) || `line-${String(line)}`}`, out.lineOf);
    out.lineOf.set(id, line);
    out.cases.push({
      id,
      message,
      history,
      tags: [...new Set(tags)],
      ...(notes !== undefined && { notes }),
      expect: { writes: parsed.writes, clarify: parsed.clarify },
    });
    history = [];
  });

  return out;
}

function parseExpectation(text: string): {
  writes: ShorthandWrite[];
  clarify: boolean;
  errors: string[];
} {
  const parts = text
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const writes: ShorthandWrite[] = [];
  const errors: string[] = [];
  let clarify = false;
  let none = false;

  if (parts.length === 0) errors.push('say what should happen after "=>": none, ask, or a write.');
  for (const part of parts) {
    if (/^none$/i.test(part)) {
      none = true;
      continue;
    }
    if (/^ask$/i.test(part)) {
      clarify = true;
      continue;
    }
    // Field lists never contain ":", so the last one separates the title from the fields.
    const colon = part.lastIndexOf(":");
    if (colon < 0) {
      errors.push(`"${part}": write it as "<title or MAL id>: <fields>", or use none / ask.`);
      continue;
    }
    const name = part.slice(0, colon).trim();
    const write = parseFields(part.slice(colon + 1), name, errors);
    if (!name) errors.push(`"${part}": the title before ":" is empty.`);
    else if (write) writes.push({ anime: /^\d+$/.test(name) ? Number(name) : name, ...write });
  }
  if (none && (clarify || writes.length > 0)) {
    errors.push('"none" means nothing should happen, so it can\'t go with "ask" or a write.');
  }
  return { writes, clarify, errors };
}

function parseFields(
  text: string,
  name: string,
  errors: string[],
): Omit<ShorthandWrite, "anime"> | null {
  const write: Omit<ShorthandWrite, "anime"> = {};
  const items = text
    .split(",")
    .map((i) =>
      i
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, " "),
    )
    .filter(Boolean);
  if (items.length === 0) {
    errors.push(`say what changes for "${name}": ep N, score N, a status or rewatching.`);
    return null;
  }
  const before = errors.length;
  const set = <K extends keyof typeof write>(key: K, value: (typeof write)[K], item: string) => {
    if (write[key] !== undefined) errors.push(`"${name}": "${item}" sets ${key} a second time.`);
    write[key] = value;
  };

  for (const item of items) {
    const episodes = /^(?:ep|eps|episode|episodes)\s*(\d+)$/.exec(item);
    const score = /^score\s*(\d+)$/.exec(item);
    if (episodes) set("episodes_watched", Number(episodes[1]), item);
    else if (score) set("score", Number(score[1]), item);
    else if (STATUSES[item]) set("status", STATUSES[item], item);
    else if (item === "rewatching") set("is_rewatching", true, item);
    else if (item === "not rewatching") set("is_rewatching", false, item);
    else {
      errors.push(
        `"${name}": couldn't read "${item}". Use ep N, score N, rewatching, not rewatching, or a status (watching, completed, on hold, dropped, plan to watch).`,
      );
    }
  }
  return errors.length === before ? write : null;
}

/** A case id from the message: lowercase words joined by dashes, at most six of them. */
function slug(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
}

function uniqueId(base: string, taken: Map<string, number>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${String(n)}`;
  return id;
}
