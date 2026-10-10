"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Icon } from "./Icon";

/**
 * A short task over the screen (the design system's Sheet): from the bottom on phones, centred
 * from 640px. It opens as a modal dialog, so focus stays inside; Escape, a tap on the scrim and
 * the close button all call `onClose`, and focus goes back where it was. Pass `onSubmit` to make
 * the body and actions one form. Children are the `k-sheet__body` and `k-sheet__actions` parts.
 */
export function Sheet({
  title,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Makes the body and actions a form; the sheet stops the page from reloading. */
  onSubmit?: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The callback can change on every render; the effects below must not reopen the dialog.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const element = dialog.current;
    const before = document.activeElement;
    if (element && !element.open) element.showModal();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="k-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: the parent decides, by unmounting the sheet.
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        // The scrim is the dialog's backdrop: a click outside the sheet's box.
        const box = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom;
        if (event.target === event.currentTarget && outside) close.current();
      }}
    >
      <span className="k-sheet__grip" aria-hidden="true" />
      <div className="k-sheet__head">
        <h2 id={titleId} className="k-sheet__title">
          {title}
        </h2>
        <button
          type="button"
          className="k-btn k-btn--ghost k-btn--icon"
          aria-label="Close"
          onClick={() => {
            close.current();
          }}
        >
          <Icon name="clear" />
        </button>
      </div>
      {onSubmit ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
        </form>
      ) : (
        children
      )}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  /** One sentence on what happens. */
  body: string;
  /** Names the action, e.g. "Delete chat". */
  action: string;
  /** A destructive action gets the danger button. */
  danger?: boolean;
}

/**
 * Asks before something that can't simply be undone, in a Sheet instead of the browser's
 * `confirm()`. `confirm` resolves true when the user takes the action; render `sheet`.
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  sheet: React.ReactNode;
} {
  const [asking, setAsking] = useState<
    (ConfirmOptions & { resolve: (yes: boolean) => void }) | null
  >(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setAsking({ ...options, resolve });
      }),
    [],
  );

  const answer = (yes: boolean) => {
    asking?.resolve(yes);
    setAsking(null);
  };

  const sheet = asking ? (
    <Sheet
      title={asking.title}
      onClose={() => {
        answer(false);
      }}
    >
      <div className="k-sheet__body">
        <p className="text-ink-muted">{asking.body}</p>
      </div>
      <div className="k-sheet__actions">
        <button
          type="button"
          className="k-btn k-btn--ghost"
          onClick={() => {
            answer(false);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className={asking.danger ? "k-btn k-btn--danger" : "k-btn k-btn--primary"}
          onClick={() => {
            answer(true);
          }}
        >
          {asking.action}
        </button>
      </div>
    </Sheet>
  ) : null;

  return { confirm, sheet };
}
