"use client";

import { MAL_USERNAME_PATTERN, waitlistJoinResponseSchema } from "@kurisu/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { postApi } from "@/lib/clientApi";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "joined"; email: string; leaveToken: string | null }
  | { kind: "already" }
  | { kind: "left" }
  | { kind: "error"; message: string };

function errorMessage(error: string): string {
  switch (error) {
    case "invalid_request":
      return "ERR Check the email address and the MyAnimeList username.";
    case "rate_limited":
      return "WARN Lots of people are joining right now. Try again in a minute.";
    case "waitlist_full":
      return "WARN The waitlist is full for now. Try again later.";
    case "network":
      return "ERR Network error. Check your connection and try again.";
    default:
      return "ERR Something went wrong. Try again.";
  }
}

/**
 * The landing page's waitlist: an email, and a MyAnimeList username if they like. A field people
 * never see, and the time the form was open, keep bots out without a CAPTCHA. After joining, the
 * link to leave is shown once.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [malUsername, setMalUsername] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  async function join() {
    setState({ kind: "sending" });
    const result = await postApi("/waitlist", waitlistJoinResponseSchema, {
      email,
      malUsername,
      website,
      elapsedMs: Math.max(0, Date.now() - openedAt.current),
    });
    if (!result.ok || !result.data) {
      setState({ kind: "error", message: errorMessage(result.ok ? "unknown" : result.error) });
      return;
    }
    setState(
      result.data.status === "joined"
        ? { kind: "joined", email: email.trim(), leaveToken: result.data.leaveToken }
        : { kind: "already" },
    );
  }

  async function leave(token: string) {
    const result = await postApi("/waitlist/leave", null, { token });
    setState(result.ok ? { kind: "left" } : { kind: "error", message: errorMessage(result.error) });
  }

  if (state.kind === "joined") {
    return (
      <div className="k-panel flex flex-col gap-2 p-4" role="status">
        <p className="text-ink">
          You&apos;re on the list. When there&apos;s a place, an invite goes to{" "}
          <span className="font-medium">{state.email}</span>.
        </p>
        {state.leaveToken && (
          <p className="k-field__hint">
            Changed your mind?{" "}
            <button
              type="button"
              className="k-link"
              onClick={() => void leave(state.leaveToken ?? "")}
            >
              Leave the waitlist
            </button>
          </p>
        )}
      </div>
    );
  }
  if (state.kind === "already" || state.kind === "left") {
    return (
      <div className="k-panel p-4" role="status">
        <p className="text-ink">
          {state.kind === "already"
            ? "That address is already on the list. The invite will go there."
            : "You're off the list. Your email is deleted."}
        </p>
      </div>
    );
  }

  const malInvalid = malUsername.trim() !== "" && !MAL_USERNAME_PATTERN.test(malUsername.trim());
  return (
    <form
      className="k-panel flex flex-col gap-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void join();
      }}
    >
      <div className="k-field">
        <label className="k-field__label" htmlFor="waitlist-email">
          Email
        </label>
        <input
          id="waitlist-email"
          className="k-input"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </div>
      <div className="k-field">
        <label className="k-field__label" htmlFor="waitlist-mal">
          MyAnimeList username <span className="text-ink-faint">(optional)</span>
        </label>
        <input
          id="waitlist-mal"
          className="k-input"
          maxLength={16}
          autoComplete="username"
          spellCheck={false}
          aria-invalid={malInvalid}
          value={malUsername}
          onChange={(e) => {
            setMalUsername(e.target.value);
          }}
        />
        <p className="k-field__hint">
          {malInvalid
            ? "2 to 16 letters, digits, underscores or hyphens."
            : "So the invite can match your list."}
        </p>
      </div>
      {/* For bots only: people never see or fill this. */}
      <div className="k-visually-hidden" aria-hidden="true">
        <label htmlFor="waitlist-website">Website</label>
        <input
          id="waitlist-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => {
            setWebsite(e.target.value);
          }}
        />
      </div>
      <button
        type="submit"
        className="k-btn k-btn--primary k-btn--lg k-btn--block"
        disabled={state.kind === "sending" || malInvalid}
      >
        {state.kind === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
      <p className="k-field__hint">
        Your email is used only to send your invite, and you can leave at any time.{" "}
        <Link className="k-link" href="/privacy">
          Privacy
        </Link>
      </p>
      <p role="alert" className="k-field__hint text-accent-text empty:hidden">
        {state.kind === "error" ? state.message : ""}
      </p>
    </form>
  );
}
