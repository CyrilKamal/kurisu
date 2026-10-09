import Link from "next/link";

export default function ChatNotFound() {
  return (
    <main className="mx-auto flex h-full max-w-(--content-max) flex-col justify-center px-4">
      <div className="k-empty">
        <p className="k-empty__count">404 · chat</p>
        <p className="k-empty__title">This chat doesn&apos;t exist</p>
        <p className="k-empty__text">It may have been deleted. Changes it made stay in History.</p>
        <Link href="/chat/new" className="k-btn k-btn--primary">
          New chat
        </Link>
      </div>
    </main>
  );
}
