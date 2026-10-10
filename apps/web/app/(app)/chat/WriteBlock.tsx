"use client";

import { shortId, type ChangeView, type PendingProposalView } from "@kurisu/shared";
import { useState } from "react";

import { Diff } from "@/components/Diff";
import { Poster, progressOf } from "@/components/Poster";
import { ShowLink } from "@/components/ShowLink";
import { addButtonLabel, confirmationReasonLabel, sourceLabel } from "@/lib/describeChange";
import { showDetails } from "@/lib/format";

/**
 * The writes a reply made to MAL, in a dashed teal border (the design system's WriteBlock): its
 * proposal ids, then one row per show with its diff and an Undo link. The border is how a write
 * is recognised, so it's never folded into the reply's sentence.
 */
export function WriteBlock({
  changes,
  onUndo,
}: {
  changes: ChangeView[];
  onUndo: (id: string) => Promise<void>;
}) {
  const allUndone = changes.every((c) => c.undone);
  return (
    <div className={`k-write${allUndone ? " k-write--undone" : ""}`}>
      <div className="k-write__head">
        <span className="k-write__level">MAL write</span>
        <span className="k-write__id">
          {[...changes.map((c) => shortId(c.proposalId)), allUndone ? "undone" : "committed"].join(
            " · ",
          )}
        </span>
      </div>
      <ul className="k-write__rows">
        {changes.map((change) => (
          <WriteRow key={change.id} change={change} onUndo={onUndo} />
        ))}
      </ul>
    </div>
  );
}

/** One change: poster, title and diff, then Undo (or "undone", struck through). */
export function WriteRow({
  change,
  onUndo,
}: {
  change: ChangeView;
  onUndo?: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const watched = change.after.episodesWatched ?? change.before.episodesWatched ?? 0;
  return (
    <li className={`k-write__row${change.undone ? " is-undone" : ""}`}>
      <Poster
        url={change.pictureUrl}
        title={change.title}
        progress={change.kind === "remove" ? null : progressOf(watched, change.numEpisodes)}
      />
      <div className="min-w-0">
        <p className="k-write__title">
          <ShowLink animeId={change.animeId}>{change.title}</ShowLink>
        </p>
        <Diff
          kind={change.kind}
          before={change.before}
          after={change.after}
          numEpisodes={change.numEpisodes}
          prefix={sourceLabel(change.source)}
        />
      </div>
      {change.undone ? (
        <span className="k-write__undone">undone</span>
      ) : (
        onUndo && (
          <button
            type="button"
            className="k-link"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              setBusy(true);
              void onUndo(change.id).finally(() => {
                setBusy(false);
              });
            }}
          >
            {busy ? "Undoing…" : "Undo"}
          </button>
        )
      )}
    </li>
  );
}

/**
 * A change held for the user's OK: a teal-tinted header, the reason in one sentence, then
 * Confirm (or the add, in words) and a Cancel link.
 */
export function HeldWrite({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: PendingProposalView;
  onConfirm: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const act = (which: "confirm" | "cancel", fn: (id: string) => Promise<void>) => {
    setBusy(which);
    void fn(proposal.id).finally(() => {
      setBusy(null);
    });
  };
  const add = proposal.kind === "add";
  const label = add ? addButtonLabel(proposal.change) : "Confirm";
  return (
    <div className="k-write k-write--held">
      <div className="k-write__head">
        <span className="k-write__level">Proposed · needs your OK</span>
        <span className="k-write__id">{shortId(proposal.id)}</span>
      </div>
      <ul className="k-write__rows">
        <li className="k-write__row">
          <Poster
            url={proposal.show?.pictureUrl ?? null}
            title={proposal.title}
            progress={
              proposal.show
                ? progressOf(proposal.show.episodesWatched, proposal.show.numEpisodes)
                : null
            }
          />
          <div className="min-w-0">
            <p className="k-write__title">
              <ShowLink animeId={proposal.animeId}>{proposal.title}</ShowLink>
            </p>
            {add && proposal.show ? (
              <p className="k-diff">{showDetails(proposal.show)}</p>
            ) : (
              <Diff kind="update" before={proposal.before} after={proposal.change} />
            )}
          </div>
        </li>
      </ul>
      <p className="k-write__reason">{confirmationReasonLabel(proposal.reason)}</p>
      <div className="k-write__actions">
        <button
          type="button"
          className="k-btn k-btn--primary k-btn--sm"
          disabled={busy !== null}
          aria-busy={busy === "confirm"}
          onClick={() => {
            act("confirm", onConfirm);
          }}
        >
          {busy === "confirm" ? (add ? "Adding…" : "Confirming…") : label}
        </button>
        <button
          type="button"
          className="k-link"
          disabled={busy !== null}
          aria-busy={busy === "cancel"}
          onClick={() => {
            act("cancel", onCancel);
          }}
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
