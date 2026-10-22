"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";

import { Icon } from "./Icon";

/** Closes the sheet it's inside the way it came (`SheetClose`). */
const SheetCloseContext = createContext<() => void>(() => undefined);

/** How long the exit can take before the sheet goes anyway (k-sheet-out is 160ms). */
const EXIT_MS = 240;

/**
 * A short task over the screen (the design system's Sheet): from the bottom on phones, centred
 * from 640px. It opens as a modal dialog, so focus stays inside; Escape, a press on the scrim,
 * the close button and `SheetClose` play its exit and then call `onClose`, and focus goes back
 * where it was. An element marked `data-autofocus` gets focus when it opens. Pass `onSubmit` to
 * make the body and actions one form. Children are the `k-sheet__body` and `k-sheet__actions`
 * parts.
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
  const [closing, setClosing] = useState(false);
  // The exit's end and its timeout can both arrive; the parent hears once.
  const closed = useRef(false);
  const finish = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    close.current();
  }, []);
  // A press that started on the scrim; a drag out of a field that ends there isn't one.
  const pressedOutside = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    const before = document.activeElement;
    if (element && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  // The parent decides, by unmounting the sheet, once its exit has played.
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(finish, EXIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [closing, finish]);
  const requestClose = useCallback(() => {
    setClosing(true);
  }, []);

  return (
    <dialog
      ref={dialog}
      className={closing ? "k-sheet is-closing" : "k-sheet"}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) finish();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget && outsideBox(event);
      }}
      onClick={(event) => {
        // The scrim is the dialog's backdrop: a press and release outside the sheet's box.
        if (pressedOutside.current && event.target === event.currentTarget && outsideBox(event)) {
          requestClose();
        }
        pressedOutside.current = false;
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
          onClick={requestClose}
        >
          <Icon name="clear" />
        </button>
      </div>
      <SheetCloseContext value={requestClose}>
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
      </SheetCloseContext>
    </dialog>
  );
}

function outsideBox(event: React.MouseEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

/** A button that closes the sheet it's in (Cancel), playing the sheet's exit first. */
export function SheetClose({
  className = "k-btn k-btn--ghost",
  disabled,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const close = useContext(SheetCloseContext);
  return (
    <button type="button" className={className} disabled={disabled} onClick={close} {...rest}>
      {children}
    </button>
  );
}

export interface ConfirmOptions {
  title: string;
  /** One sentence on what happens. */
  body: string;
  /** Names the action, e.g. "Delete chat". */
  action: string;
  /** A destructive action gets the destructive button. */
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
        <SheetClose data-autofocus>Cancel</SheetClose>
        <button
          type="button"
          className={asking.danger ? "k-btn k-btn--destructive" : "k-btn k-btn--primary"}
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
