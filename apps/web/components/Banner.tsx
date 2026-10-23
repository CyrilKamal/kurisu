const LEVELS = {
  info: { word: "Info", className: "k-banner" },
  warn: { word: "Warn", className: "k-banner k-banner--warn" },
  error: { word: "Err", className: "k-banner k-banner--error" },
} as const;

/**
 * A notice with its log level first (the design system's Banner): WARN, INFO or ERR, what
 * happened and what to do, and an optional action on the right.
 */
export function Banner({
  level,
  children,
  action,
  className,
  live = true,
}: {
  level: keyof typeof LEVELS;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** False when a live region elsewhere already announces it (the Toast's). */
  live?: boolean;
}) {
  const { word, className: base } = LEVELS[level];
  return (
    <div
      className={className ? `${base} ${className}` : base}
      role={live ? (level === "info" ? "status" : "alert") : undefined}
    >
      <span className="k-banner__level">{word}</span>
      <p>{children}</p>
      {action ?? <span />}
    </div>
  );
}
