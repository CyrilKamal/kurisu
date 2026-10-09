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
}: {
  level: keyof typeof LEVELS;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const { word, className: base } = LEVELS[level];
  return (
    <div
      className={className ? `${base} ${className}` : base}
      role={level === "info" ? "status" : "alert"}
    >
      <span className="k-banner__level">{word}</span>
      <p>{children}</p>
      {action ?? <span />}
    </div>
  );
}
