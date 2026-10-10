import Link from "next/link";

import { Icon } from "./Icon";

/**
 * The top of a screen (the design system's ScreenHeader): its title, a status line, and ghost
 * actions, closed by a hairline. A sub-screen starts with Back, a chevron to where it belongs.
 * The primary action never goes here.
 */
export function ScreenHeader({
  title,
  sub,
  actions,
  back,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  /** Where Back goes, on a sub-screen. */
  back?: string;
}) {
  return (
    <header className="k-header flex-wrap">
      {back && (
        <Link
          href={back}
          className="k-btn k-btn--ghost k-btn--icon k-header__back"
          aria-label="Back"
        >
          <Icon name="chevron-left" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="k-header__title">{title}</h1>
        {sub && <p className="k-header__sub">{sub}</p>}
      </div>
      {actions && <div className="k-header__actions">{actions}</div>}
    </header>
  );
}
