"use client";

import type { ChangeView, PendingProposalView } from "@kurisu/shared";
import { useState } from "react";

import {
  addButtonLabel,
  confirmationReasonLabel,
  describeChange,
  describeWrite,
  sourceLabel,
} from "@/lib/describeChange";

import { Cover, showDetails } from "./chat/ShowCard";

/** A write (by the agent, the user, an import, or an undo), with an Undo button. */
export function ChangeCard({
  change,
  onUndo,
}: {
  change: ChangeView;
  onUndo: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0">
        <p className="truncate font-medium">{change.title}</p>
        <p className="text-zinc-500">
          {sourceLabel(change.source) ? `${sourceLabel(change.source) ?? ""}: ` : ""}
          {describeWrite(change.kind, change.before, change.after)}
        </p>
      </div>
      {change.undone ? (
        <span className="shrink-0 text-xs text-zinc-500">Undone</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onUndo(change.id).finally(() => {
              setBusy(false);
            });
          }}
          className="h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {busy ? "Undoing…" : "Undo"}
        </button>
      )}
    </div>
  );
}

/** A change held for the user's go-ahead. */
export function PendingCard({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: PendingProposalView;
  onConfirm: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const act = (fn: (id: string) => Promise<void>) => {
    setBusy(true);
    void fn(proposal.id).finally(() => {
      setBusy(false);
    });
  };
  const add = proposal.kind === "add";
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950">
      {add && proposal.show ? (
        <div className="flex items-start gap-3">
          <Cover url={proposal.show.pictureUrl} />
          <div className="min-w-0">
            <a
              href={`https://myanimelist.net/anime/${String(proposal.animeId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="line-clamp-2 font-medium leading-snug hover:underline"
            >
              {proposal.title}
            </a>
            <p className="text-xs text-zinc-600 dark:text-zinc-300">{showDetails(proposal.show)}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="font-medium">{proposal.title}</p>
          <p className="text-zinc-600 dark:text-zinc-300">
            {describeChange(proposal.before, proposal.change)}
          </p>
        </>
      )}
      <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
        {confirmationReasonLabel(proposal.reason)}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            act(onConfirm);
          }}
          className="h-8 rounded-md bg-blue-700 px-3 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {add ? addButtonLabel(proposal.change) : "Confirm"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            act(onCancel);
          }}
          className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
