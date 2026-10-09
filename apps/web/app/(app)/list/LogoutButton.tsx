"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { forgetPushOnThisBrowser } from "@/lib/pushDevice";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await forgetPushOnThisBrowser(true);
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      className="k-btn k-btn--ghost"
      onClick={() => void logout()}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}
