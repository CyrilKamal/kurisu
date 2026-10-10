"use client";

import { changeResponseSchema, type ChangeView } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useFinish } from "@/components/FinishSheet";
import { useToast } from "@/components/Toast";

import { postApi } from "./clientApi";
import { describeWrite } from "./describeChange";
import { editErrorMessage } from "./editEntry";
import { notifyListChanged } from "./listChanged";

/**
 * After a write made outside Chat: says what changed in a Toast with Undo, and refreshes the
 * screen; a write that finished a show also opens the "Finished" sheet. Undo goes through the
 * same undo path as the Journal.
 */
export function useWriteToast(): {
  written: (change: ChangeView) => void;
  failed: (error: string) => void;
} {
  const toast = useToast();
  const finish = useFinish();
  const router = useRouter();

  const refresh = useCallback(() => {
    router.refresh();
    notifyListChanged();
  }, [router]);

  const failed = useCallback(
    (error: string) => {
      toast({ level: "error", text: editErrorMessage(error) });
    },
    [toast],
  );

  const written = useCallback(
    (change: ChangeView) => {
      refresh();
      finish(change);
      toast({
        text: `${change.title}: ${describeWrite(change.kind, change.before, change.after)}`,
        // An undo itself isn't undone from here; History still has it.
        ...(!change.isUndo && {
          undo: async () => {
            const result = await postApi(`/changes/${change.id}/undo`, changeResponseSchema);
            if (result.ok && result.data) {
              const undo = result.data.change;
              refresh();
              toast({
                text: `${undo.title}: ${describeWrite(undo.kind, undo.before, undo.after)}`,
              });
            } else if (!result.ok) {
              failed(result.error);
            }
          },
        }),
      });
    },
    [failed, finish, refresh, toast],
  );

  return { written, failed };
}
