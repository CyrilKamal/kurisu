/**
 * The top of a screen (the design system's ScreenHeader): its title, a mono status line, and
 * ghost actions, closed by a hairline. The primary action never goes here.
 */
export function ScreenHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="k-header flex-wrap">
      <div className="min-w-0">
        <h1 className="k-header__title">{title}</h1>
        {sub && <p className="k-header__sub">{sub}</p>}
      </div>
      {actions && <div className="k-header__actions">{actions}</div>}
    </header>
  );
}
