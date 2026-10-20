"use client";

import { alertMuteResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { sendApi } from "@/lib/clientApi";

/**
 * A Watching show's episode alerts: on (the bell) or muted for this show alone. Alerts for every
 * other show stay as they are; Settings turns them all off.
 */
export function AlertBell({
  animeId,
  title,
  muted: initial,
}: {
  animeId: number;
  title: string;
  muted: boolean;
}) {
  const [muted, setMuted] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    const next = !muted;
    setBusy(true);
    setFailed(false);
    setMuted(next);
    const result = await sendApi(
      "PUT",
      `/alerts/shows/${String(animeId)}`,
      alertMuteResponseSchema,
      { muted: next },
    );
    setBusy(false);
    if (!result.ok) {
      setMuted(!next);
      setFailed(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className={muted ? "k-btn k-btn--ghost k-btn--sm" : "k-btn k-btn--sm"}
        aria-pressed={!muted}
        aria-label={
          muted ? `Turn on episode alerts for ${title}` : `Mute episode alerts for ${title}`
        }
        disabled={busy}
        onClick={() => void toggle()}
      >
        <Icon name="bell" />
        {muted ? "Muted" : "Alerts on"}
      </button>
      {failed && (
        <p role="alert" className="k-field__hint">
          Couldn&apos;t change that. Try again.
        </p>
      )}
    </>
  );
}
