"use client";

import { useEffect, useState } from "react";

/** After this long, the bubble says it's still working: questions can take a while. */
const STILL_THINKING_AFTER_MS = 8_000;

/** The assistant's side while a reply is on its way: three bouncing dots and a few words. */
export function ThinkingBubble() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSlow(true);
    }, STILL_THINKING_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      role="status"
      className="inline-flex items-center gap-2 rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
    >
      <span aria-hidden className="flex items-center gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 rounded-full bg-zinc-400 motion-safe:animate-bounce dark:bg-zinc-500"
            style={{ animationDelay: `${String(delay)}ms` }}
          />
        ))}
      </span>
      {slow ? "Still working on it…" : "Thinking…"}
    </div>
  );
}
