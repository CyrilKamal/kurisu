"use client"; // Error boundaries must be Client Components

import { Banner } from "@/components/Banner";

/** A screen that failed to load, inside the app's layout, so the NavBar stays. */
export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-4 px-4 pt-6 pb-nav">
      <Banner level="error">
        kurisu couldn&apos;t load this screen. The server may be restarting.
      </Banner>
      <div>
        <button type="button" className="k-btn" onClick={retry}>
          Try again
        </button>
      </div>
    </main>
  );
}
