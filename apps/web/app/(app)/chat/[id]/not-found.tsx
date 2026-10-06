import Link from "next/link";

export default function ChatNotFound() {
  return (
    <main className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center text-sm text-zinc-500">
      <p>This chat doesn&apos;t exist, or it was deleted.</p>
      <Link
        href="/chat/new"
        className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
      >
        New chat
      </Link>
    </main>
  );
}
