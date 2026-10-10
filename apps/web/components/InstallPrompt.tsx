"use client";

import { useState } from "react";

import { promptInstall, useInstallState } from "@/lib/install";

/**
 * Installing kurisu on this device: the browser's own prompt where there is one, and the steps
 * by hand on iPhone and iPad, where the morning brief's notifications need it on the Home
 * Screen.
 */
export function InstallPrompt({ onInstalled }: { onInstalled?: () => void }) {
  const state = useInstallState();
  const [busy, setBusy] = useState(false);

  switch (state) {
    case null:
      return <p className="text-ink-faint">Checking…</p>;
    case "installed":
      return <p className="text-ink-muted">kurisu is installed on this device.</p>;
    case "promptable":
      return (
        <button
          type="button"
          className="k-btn k-btn--primary self-start"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            setBusy(true);
            void promptInstall().then((installed) => {
              setBusy(false);
              if (installed) onInstalled?.();
            });
          }}
        >
          Install kurisu
        </button>
      );
    case "ios":
      return (
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-6 text-ink">
          <li>Tap Share at the bottom of Safari.</li>
          <li>Tap &ldquo;Add to Home Screen&rdquo;, then Add.</li>
          <li>Open kurisu from your Home Screen. Notifications work from there.</li>
        </ol>
      );
    case "unavailable":
      return (
        <p className="text-ink-muted">
          This browser doesn&apos;t offer to install kurisu. Look for &ldquo;Install&rdquo; or
          &ldquo;Add to Home Screen&rdquo; in its menu, or keep using it here.
        </p>
      );
  }
}
