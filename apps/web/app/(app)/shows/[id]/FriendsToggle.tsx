"use client";

import { friendHiddenResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { sendApi } from "@/lib/clientApi";

/**
 * Whether friends see this show: in their feed, on its page, in the taste match and among your
 * favorites. Hentai and Erotica start hidden; any show can be hidden or shown here.
 */
export function FriendsToggle({
  animeId,
  title,
  hidden: initial,
}: {
  animeId: number;
  title: string;
  hidden: boolean;
}) {
  const [hidden, setHidden] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    const next = !hidden;
    setBusy(true);
    setFailed(false);
    setHidden(next);
    const result = await sendApi(
      "PUT",
      `/friends/hidden/${String(animeId)}`,
      friendHiddenResponseSchema,
      { hidden: next },
    );
    setBusy(false);
    if (!result.ok) {
      setHidden(!next);
      setFailed(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className={hidden ? "k-btn k-btn--ghost k-btn--sm" : "k-btn k-btn--sm"}
        aria-pressed={!hidden}
        aria-label={hidden ? `Show ${title} to friends` : `Hide ${title} from friends`}
        disabled={busy}
        onClick={() => void toggle()}
      >
        <Icon name="users" />
        {hidden ? "Hidden from friends" : "Friends see it"}
      </button>
      {failed && (
        <p role="alert" className="k-field__hint">
          Couldn&apos;t change that. Try again.
        </p>
      )}
    </>
  );
}
