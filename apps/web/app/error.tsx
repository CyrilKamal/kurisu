"use client"; // Error boundaries must be Client Components

export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        kurisu couldn&apos;t load this page. The server may be restarting.
      </p>
      <button
        type="button"
        onClick={retry}
        className="h-10 rounded-lg border border-zinc-300 px-4 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Try again
      </button>
    </main>
  );
}
