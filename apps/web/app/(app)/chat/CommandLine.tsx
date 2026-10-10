"use client";

import { useLayoutEffect, useRef } from "react";

import { Icon } from "@/components/Icon";

/**
 * Where you type (the design system's CommandLine): an inset well with the crimson prompt, an
 * "↵ send" hint and a square send button. Enter sends and Shift+Enter adds a line. A send that
 * failed shows above it with an ERR tag, and its text comes back to the field.
 */
export function CommandLine({
  draft,
  onDraft,
  onSend,
  busy,
  notice,
}: {
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  /** A reply is on its way. */
  busy: boolean;
  notice: string | null;
}) {
  const field = useRef<HTMLTextAreaElement>(null);

  // The field grows with what's typed, up to its max height; empty, it's one line.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "";
    if (draft) el.style.height = `${String(el.scrollHeight)}px`;
  }, [draft]);

  const empty = draft.trim().length === 0;
  return (
    <div className="flex flex-col gap-2 py-2">
      {notice && (
        <p className="k-cmd__notice" role="alert">
          <span className="k-tag k-tag--word text-accent-text">Err</span>
          {notice}
        </p>
      )}
      <form
        className="k-cmd"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <span className="k-cmd__prompt" aria-hidden="true">
          ›
        </span>
        <textarea
          ref={field}
          rows={1}
          value={draft}
          maxLength={1000}
          autoComplete="off"
          placeholder="watched ep 5 of …"
          aria-label="Message"
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!busy && !empty) onSend();
            }
          }}
        />
        <span className="k-cmd__hint pointer-coarse:hidden">↵ send</span>
        <button
          type="submit"
          className="k-btn k-btn--primary k-btn--icon"
          aria-label="Send"
          disabled={busy || empty}
        >
          <Icon name="send" />
        </button>
      </form>
    </div>
  );
}
