"use client";

import { changeResponseSchema, changesResponseSchema, type ChangeView } from "@kurisu/shared";
import { useState } from "react";

import { getApi, postApi } from "@/lib/clientApi";
import { writeErrorMessage } from "@/lib/describeChange";
import { relativeTime } from "@/lib/format";

import { ChangeCard } from "../../ChangeCards";

export function ChangeLog({ initialChanges }: { initialChanges: ChangeView[] }) {
  const [changes, setChanges] = useState(initialChanges);
  const [notice, setNotice] = useState<string | null>(null);

  async function undo(id: string) {
    setNotice(null);
    const result = await postApi(`/changes/${id}/undo`, changeResponseSchema);
    if (!result.ok) setNotice(writeErrorMessage(result.error));
    const fresh = await getApi("/changes", changesResponseSchema);
    if (fresh.ok) setChanges(fresh.data.changes);
  }

  if (changes.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-zinc-500">
        No changes yet. Updates you make in Chat show up here.
      </p>
    );
  }

  return (
    <>
      {notice && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {notice}
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {changes.map((change) => (
          <li key={change.id}>
            <p className="mb-1 text-xs text-zinc-500">{relativeTime(change.committedAt)}</p>
            <ChangeCard change={change} onUndo={undo} />
          </li>
        ))}
      </ul>
    </>
  );
}
