"use client"; // Error boundaries must be Client Components

import { Banner } from "@/components/Banner";

export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <Banner level="error">
        kurisu couldn&apos;t load this page. The server may be restarting.
      </Banner>
      <div>
        <button type="button" className="k-btn" onClick={retry}>
          Try again
        </button>
      </div>
    </main>
  );
}
