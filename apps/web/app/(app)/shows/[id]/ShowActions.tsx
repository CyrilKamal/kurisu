"use client";

import { changeResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { AddSheet } from "@/components/AddSheet";
import { Icon } from "@/components/Icon";
import { sendApi } from "@/lib/clientApi";
import { canAddEpisode, type EditableEntry } from "@/lib/editEntry";
import { useWriteToast } from "@/lib/useWriteToast";

import { EditSheet } from "../../list/EditSheet";
import { AlertBell } from "./AlertBell";
import { FavoriteButton } from "./FavoriteButton";

/**
 * A show page's actions: "+1 ep" and Edit for a show on your list, or Add for one that isn't.
 * Each goes through the same write path as the List screen, with a Toast and Undo. A Watching
 * show also has its episode alerts' bell, when they're on, and any show the favorites' heart.
 */
export function ShowActions({
  show,
  entry,
  alert = null,
  favorite = null,
}: {
  show: { animeId: number; title: string; numEpisodes: number | null };
  entry: Omit<EditableEntry, "animeId" | "title" | "numEpisodes"> | null;
  alert?: { muted: boolean } | null;
  /** Whether it's one of the user's favorites; null leaves the heart out. */
  favorite?: boolean | null;
}) {
  const heart = favorite !== null && (
    <FavoriteButton animeId={show.animeId} title={show.title} favorite={favorite} />
  );
  const toast = useWriteToast();
  const [sheet, setSheet] = useState<"edit" | "add" | null>(null);
  const [busy, setBusy] = useState(false);

  if (!entry) {
    return (
      <div className="k-show__actions">
        <button
          type="button"
          className="k-btn k-btn--primary"
          onClick={() => {
            setSheet("add");
          }}
        >
          <Icon name="plus" />
          Add to my list
        </button>
        {heart}
        {sheet === "add" && (
          <AddSheet
            show={show}
            onClose={() => {
              setSheet(null);
            }}
          />
        )}
      </div>
    );
  }

  const editable: EditableEntry = { ...show, ...entry };

  async function addEpisode() {
    setBusy(true);
    const result = await sendApi(
      "POST",
      `/list/${String(show.animeId)}/edit`,
      changeResponseSchema,
      { episodesWatched: editable.episodesWatched + 1, requestId: crypto.randomUUID() },
    );
    setBusy(false);
    if (result.ok && result.data) toast.written(result.data.change);
    else if (!result.ok) toast.failed(result.error);
  }

  return (
    <div className="k-show__actions">
      {canAddEpisode(editable) && (
        <button
          type="button"
          className="k-btn k-btn--sm"
          disabled={busy}
          aria-busy={busy}
          aria-label={`Watched episode ${String(editable.episodesWatched + 1)} of ${show.title}`}
          onClick={() => void addEpisode()}
        >
          {busy ? "Saving…" : "+1 ep"}
        </button>
      )}
      <button
        type="button"
        className="k-btn k-btn--ghost k-btn--sm"
        onClick={() => {
          setSheet("edit");
        }}
      >
        <Icon name="rename" />
        Edit
      </button>
      {alert && <AlertBell animeId={show.animeId} title={show.title} muted={alert.muted} />}
      {heart}
      {sheet === "edit" && (
        <EditSheet
          entry={editable}
          onClose={() => {
            setSheet(null);
          }}
          onSaved={(change) => {
            setSheet(null);
            toast.written(change);
          }}
        />
      )}
    </div>
  );
}
