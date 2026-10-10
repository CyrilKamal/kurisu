"use client";

import { useState } from "react";

import { postApi } from "@/lib/clientApi";

/**
 * "Report", at the end of a reply's run line: tells the owner a reply was wrong, with what went
 * wrong in the user's words if they give any. The reply and the list as it was go to the review
 * queue, privately. Writing the note takes its own line under the run's.
 */
export function ReportReply({ messageId }: { messageId: string }) {
  const [state, setState] = useState<"idle" | "writing" | "sending" | "sent" | "failed">("idle");
  const [note, setNote] = useState("");

  async function send() {
    setState("sending");
    const trimmed = note.trim();
    const result = await postApi(
      `/chat/messages/${messageId}/report`,
      null,
      trimmed ? { note: trimmed } : {},
    );
    setState(result.ok ? "sent" : "failed");
  }

  if (state === "sent") {
    return (
      <span className="basis-full font-sans">
        Reported. Thanks, that helps kurisu get it right.
      </span>
    );
  }
  if (state === "idle") {
    return (
      <button
        type="button"
        className="k-link"
        aria-label="Report a problem with this reply"
        onClick={() => {
          setState("writing");
        }}
      >
        Report
      </button>
    );
  }
  return (
    <form
      className="flex basis-full flex-col gap-2 pt-2 font-sans"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="k-field__label" htmlFor={`report-${messageId}`}>
        What went wrong? (optional)
      </label>
      <textarea
        id={`report-${messageId}`}
        className="k-input"
        rows={2}
        maxLength={500}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
      />
      <div className="flex gap-2">
        <button type="submit" className="k-btn k-btn--sm" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Report"}
        </button>
        <button
          type="button"
          className="k-btn k-btn--ghost k-btn--sm"
          onClick={() => {
            setState("idle");
          }}
        >
          Cancel
        </button>
      </div>
      {state === "failed" && (
        <p className="k-field__hint" role="status">
          Couldn&apos;t send that. Try again.
        </p>
      )}
    </form>
  );
}
