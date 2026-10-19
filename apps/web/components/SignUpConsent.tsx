"use client";

import Link from "next/link";
import { useState } from "react";

import { signUpUrl } from "@/lib/signup";

/**
 * The two boxes every new account ticks: 18 or older (Gemini's terms require it), and the terms
 * and privacy policy accepted. The links open in a new tab, so the ticks stay.
 */
export function ConsentChecks({
  adult,
  accepted,
  onAdult,
  onAccepted,
}: {
  adult: boolean;
  accepted: boolean;
  onAdult: (value: boolean) => void;
  onAccepted: (value: boolean) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="k-visually-hidden">Before you go on</legend>
      <label className="k-check items-start">
        <input
          type="checkbox"
          className="mt-1"
          checked={adult}
          onChange={(event) => {
            onAdult(event.target.checked);
          }}
        />
        <span>I&apos;m 18 or older.</span>
      </label>
      <label className="k-check items-start">
        <input
          type="checkbox"
          className="mt-1"
          checked={accepted}
          onChange={(event) => {
            onAccepted(event.target.checked);
          }}
        />
        <span>
          I accept kurisu&apos;s{" "}
          <Link href="/terms" target="_blank" className="k-link">
            terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="k-link">
            privacy policy
          </Link>
          .
        </span>
      </label>
    </fieldset>
  );
}

/**
 * Signing up: the two boxes, then MyAnimeList's login. The server records both with the terms'
 * version, and turns away a new account without them.
 */
export function SignUpConsent({ invite, action }: { invite?: string; action: string }) {
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const ready = adult && accepted;
  return (
    <div className="flex flex-col gap-4">
      <ConsentChecks
        adult={adult}
        accepted={accepted}
        onAdult={setAdult}
        onAccepted={setAccepted}
      />
      {ready ? (
        // A full navigation: the server redirects to MAL's consent page.
        <a href={signUpUrl(invite)} className="k-btn k-btn--primary k-btn--lg k-btn--block">
          {action}
        </a>
      ) : (
        <button type="button" className="k-btn k-btn--primary k-btn--lg k-btn--block" disabled>
          {action}
        </button>
      )}
      <p className="k-field__hint text-center">
        You&apos;ll approve access on myanimelist.net, then come right back.
      </p>
    </div>
  );
}
