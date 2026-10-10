"use client";

import { useRouter } from "next/navigation";

import { Icon } from "./Icon";

/**
 * Back for a screen many places open, like a show's page: to wherever you came from, or to
 * `fallback` when the page was opened directly.
 */
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="k-btn k-btn--ghost k-btn--icon k-header__back"
      aria-label="Back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      <Icon name="chevron-left" />
    </button>
  );
}
