"use client";

import type { DropReasonView } from "@kurisu/shared";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";
import { relativeTime } from "@/lib/format";
import { DROP_CATEGORY_LABELS } from "@/lib/taste";

/** The reasons given for dropping shows, newest first, each one deletable. */
export function DropReasons({ initialReasons }: { initialReasons: DropReasonView[] }) {
  const [reasons, setReasons] = useState(initialReasons);
  const [notice, setNotice] = useState<string | null>(null);

  async function remove(reason: DropReasonView) {
    const question = `Forget why you dropped ${reason.title}? Your list stays as it is.`;
    if (!window.confirm(question)) return;
    setNotice(null);
    setReasons((current) => current.filter((r) => r.id !== reason.id));
    const result = await sendApi("DELETE", `/taste/drop-reasons/${reason.id}`, null);
    // A 404 means it's already gone.
    if (!result.ok && result.status !== 404) {
      setReasons((current) =>
        [...current, reason].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      setNotice("Couldn't delete that reason. Please try again.");
    }
  }

  if (reasons.length === 0) {
    return (
      <p className="mt-2 text-sm text-zinc-500">
        None yet. When you drop a show in Chat and say why, like &ldquo;dropping X, way too
        slow&rdquo;, the reason is remembered here.
      </p>
    );
  }

  return (
    <>
      {notice && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {notice}
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-2">
        {reasons.map((reason) => (
          <li
            key={reason.id}
            className="flex items-start gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <a
                  href={`https://myanimelist.net/anime/${String(reason.animeId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  {reason.title}
                </a>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {DROP_CATEGORY_LABELS[reason.category]}
                </span>
                <span className="text-xs text-zinc-500">{relativeTime(reason.createdAt)}</span>
              </div>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">&ldquo;{reason.said}&rdquo;</p>
            </div>
            <button
              type="button"
              onClick={() => void remove(reason)}
              aria-label={`Delete the reason for dropping ${reason.title}`}
              className="h-8 shrink-0 rounded-md px-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-red-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-red-400"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
