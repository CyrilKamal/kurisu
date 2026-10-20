"use client";

import { scoreStyleResponseSchema, type ScoreStyle } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";
import { scoreScale, scoreText } from "@/lib/score";

const OPTIONS: [ScoreStyle, string][] = [
  ["point_10", "10 points"],
  ["point_100", "100 points"],
  ["stars_5", "5 stars"],
];

/**
 * How scores look across the app: MyAnimeList's 10 points, 100 points, or 5 stars with halves.
 * Each maps exactly onto MyAnimeList's 1–10, which is what's saved; Chat still talks in 10s.
 */
export function ScoreStylePicker({ initial }: { initial: ScoreStyle }) {
  const router = useRouter();
  const [style, setStyle] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const example = (score: number) => `${scoreText(score, style)}${scoreScale(style)}`;

  async function choose(next: ScoreStyle) {
    if (next === style) return;
    setBusy(true);
    setMessage(null);
    const result = await sendApi("PUT", "/me/score-style", scoreStyleResponseSchema, {
      style: next,
    });
    setBusy(false);
    if (result.ok && result.data) {
      setStyle(result.data.scoreStyle);
      router.refresh();
    } else {
      setMessage("Couldn't save that. Try again.");
    }
  }

  return (
    <section className="pt-6">
      <h2 className="k-caps pb-2">Scores</h2>
      <div className="k-panel flex flex-col gap-4 p-4">
        <div className="k-chips" role="group" aria-label="Show scores as">
          {OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="k-chip"
              aria-pressed={style === value}
              disabled={busy}
              onClick={() => void choose(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="k-field__hint">
          An 8 shows as {example(8)} and a 7 as {example(7)}. MyAnimeList still saves its 1–10, so
          no score changes, and Chat keeps talking in 10s.
        </p>
        <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
          {message}
        </p>
      </div>
    </section>
  );
}
