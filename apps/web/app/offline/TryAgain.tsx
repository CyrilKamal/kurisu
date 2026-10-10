"use client";

/** Reloads the page the user was trying to open. */
export function TryAgain() {
  return (
    <button
      type="button"
      className="k-btn"
      onClick={() => {
        window.location.reload();
      }}
    >
      Try again
    </button>
  );
}
