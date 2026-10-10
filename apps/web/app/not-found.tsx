import Link from "next/link";

/** A page that doesn't exist, with the way home. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-(--content-max) flex-col justify-center px-4">
      <div className="k-empty">
        <p className="k-empty__count">404 · page</p>
        <p className="k-empty__title">Nothing here</p>
        <p className="k-empty__text">This page moved or never existed.</p>
        <Link href="/today" className="k-btn">
          Go to Today
        </Link>
      </div>
    </main>
  );
}
