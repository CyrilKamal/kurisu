/**
 * The design system's icons (its Icons group): a 24px grid drawn at 16px, 1.5 stroke, square
 * caps and mitred joins, in currentColor (bundle.css `.k-icon`). Pair each with a word, or give
 * an icon-only button an aria-label.
 */
const ICONS = {
  "status-watching": <path d="M8 5.5v13l10.5-6.5Z" />,
  "status-completed": <path d="m5 12.5 4.5 4.5L19 7.5" />,
  "status-on-hold": <path d="M9 6v12M15 6v12" />,
  "status-dropped": <path d="M5 5h14v14H5ZM5 19 19 5" />,
  "status-planned": <path d="M7 4h10v16l-5-3.5L7 20Z" />,
  chat: (
    <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
  ),
  list: <path d="M4 5h4v6H4ZM4 14h4v6H4ZM11 7h9M11 9.5h6M11 16h9M11 18.5h6" />,
  grid: <path d="M4 4h6v9H4ZM14 4h6v9h-6ZM4 17h6M14 17h6M4 20h4M14 20h4" />,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9Z" />,
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  sync: (
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />
  ),
  ticket: <path d="M4 7.5V6h16v1.5a2.5 2.5 0 0 0 0 5V18H4v-5.5a2.5 2.5 0 0 0 0-5ZM14 6v12" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  "new-chat": (
    <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" />
  ),
  rename: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  clear: <path d="M6 6l12 12M18 6 6 18" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
} as const;

export type IconName = keyof typeof ICONS;

/** One icon, hidden from assistive tech: the word beside it, or the button's label, says it. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className ? `k-icon ${className}` : "k-icon"}
    >
      {ICONS[name]}
    </svg>
  );
}
