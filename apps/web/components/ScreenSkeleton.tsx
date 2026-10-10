/**
 * What a screen shows while its data loads: its header, and rows where the content will be,
 * without motion (the design system has no shimmer).
 */
export function ScreenSkeleton({ title, rows = 6 }: { title: string; rows?: number }) {
  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav" aria-busy="true">
      <header className="k-header">
        <div className="min-w-0 flex-1">
          <h1 className="k-header__title">{title}</h1>
          <p className="k-header__sub">loading…</p>
        </div>
      </header>
      <ul className="k-rows pt-6" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="k-row">
            <span className="k-poster k-poster--sm" />
            <span className="block h-4 w-1/2 bg-surface" />
            <span />
          </li>
        ))}
      </ul>
    </main>
  );
}
