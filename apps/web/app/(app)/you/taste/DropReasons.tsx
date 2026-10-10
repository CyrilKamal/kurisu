"use client";

import type { DropReasonView } from "@kurisu/shared";
import { useState } from "react";

import { Banner } from "@/components/Banner";
import { Icon } from "@/components/Icon";
import { Poster } from "@/components/Poster";
import { useConfirm } from "@/components/Sheet";
import { sendApi } from "@/lib/clientApi";
import { relativeTime } from "@/lib/format";
import { DROP_CATEGORY_LABELS } from "@/lib/taste";

/**
 * The reasons given for dropping shows, newest first, in the user's own words (the design
 * system's DropReason). Each one can be forgotten.
 */
export function DropReasons({ initialReasons }: { initialReasons: DropReasonView[] }) {
  const [reasons, setReasons] = useState(initialReasons);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, sheet } = useConfirm();

  async function remove(reason: DropReasonView) {
    const yes = await confirm({
      title: "Forget this reason?",
      body: `Why you dropped ${reason.title} is forgotten. Your list stays as it is.`,
      action: "Forget it",
      danger: true,
    });
    if (!yes) return;
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
      <p className="k-field__hint pt-2">
        None yet. When you drop a show in Chat and say why, like &ldquo;dropping X, way too
        slow&rdquo;, the reason is remembered here.
      </p>
    );
  }

  return (
    <>
      {notice && (
        <Banner level="error" className="mt-2">
          {notice}
        </Banner>
      )}
      <ul className="k-drops pt-2">
        {reasons.map((reason) => (
          <li key={reason.id} className="k-drop">
            <Poster url={reason.pictureUrl} title={reason.title} />
            <div className="min-w-0">
              <div className="k-drop__head">
                <a
                  className="k-drop__title hover:underline"
                  href={`https://myanimelist.net/anime/${String(reason.animeId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {reason.title}
                </a>
                <span className="k-tag k-tag--word">{DROP_CATEGORY_LABELS[reason.category]}</span>
                <span className="k-mono">{relativeTime(reason.createdAt)}</span>
              </div>
              <p className="k-drop__said">{reason.said}</p>
            </div>
            <button
              type="button"
              className="k-btn k-btn--danger k-btn--icon k-btn--sm"
              onClick={() => void remove(reason)}
              aria-label={`Forget the reason for dropping ${reason.title}`}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      {sheet}
    </>
  );
}
