"use client";

import { TERMS_VERSION, termsAcceptResponseSchema } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConsentChecks } from "@/components/SignUpConsent";
import { postApi } from "@/lib/clientApi";

/** The two boxes and Continue, which records them for this version of the terms. */
export function AcceptTerms() {
  const router = useRouter();
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setMessage(null);
    const result = await postApi("/me/terms", termsAcceptResponseSchema, {
      version: TERMS_VERSION,
    });
    if (result.ok) {
      router.replace("/today");
      router.refresh();
      return;
    }
    setBusy(false);
    // The terms changed again while this page was open: show the new ones.
    if (result.error === "outdated_terms") {
      window.location.reload();
      return;
    }
    setMessage("Couldn't save that. Try again.");
  }

  return (
    <div className="flex flex-col gap-4">
      <ConsentChecks
        adult={adult}
        accepted={accepted}
        onAdult={setAdult}
        onAccepted={setAccepted}
      />
      <button
        type="button"
        className="k-btn k-btn--primary k-btn--lg k-btn--block"
        disabled={!adult || !accepted || busy}
        aria-busy={busy}
        onClick={() => void accept()}
      >
        Continue
      </button>
      <p role="status" aria-live="polite" className="k-field__hint empty:hidden">
        {message}
      </p>
    </div>
  );
}
