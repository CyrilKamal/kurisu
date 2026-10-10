"use client";

import { useEffect, useState } from "react";

import { clockTime, secondsLabel } from "@/lib/runMeta";
import { useIsBrowser } from "@/lib/useIsBrowser";

/** After this long, the working line says it's still working: questions can take a while. */
const STILL_WORKING_AFTER_MS = 8_000;

/**
 * One entry of the chat log (the design system's LogEntry): the time in its gutter, then the
 * entry; on a phone the time sits above it, so the text gets the whole width. Your lines sit on a
 * surface band behind the crimson prompt.
 */
export function LogEntry({
  at,
  user = false,
  sending = false,
  children,
}: {
  at: string;
  user?: boolean;
  sending?: boolean;
  children: React.ReactNode;
}) {
  const inBrowser = useIsBrowser();
  const classes = [
    "k-log__entry",
    user && "k-log__entry--user",
    sending && "k-log__entry--sending",
  ].filter(Boolean);
  return (
    <li className={`${classes.join(" ")} max-sm:grid-cols-1 max-sm:pl-4`}>
      {/* The viewer's time zone, so only once in the browser. */}
      <time className="k-log__time max-sm:pl-0 max-sm:leading-4" dateTime={at}>
        {inBrowser ? clockTime(at) : ""}
      </time>
      <div className="k-log__body">{children}</div>
    </li>
  );
}

/** While a reply is on its way: a blinking crimson cursor, "Working…" and a live timer. */
export function Working({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = new Date(since).getTime();
    const tick = () => {
      setElapsed(Date.now() - started);
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => {
      clearInterval(timer);
    };
  }, [since]);

  return (
    <p className="k-log__working" role="status">
      <span className="k-cursor" aria-hidden="true" />
      {elapsed >= STILL_WORKING_AFTER_MS ? "Still working…" : "Working…"}{" "}
      <span className="k-mono" aria-hidden="true">
        {secondsLabel(elapsed)}
      </span>
    </p>
  );
}
