import { briefSettingsResponseSchema, pushPublicKeyResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

import { BriefSettingsForm } from "./BriefSettingsForm";
import { Notifications } from "./Notifications";

export const metadata: Metadata = { title: "Morning brief · kurisu" };

/** When the morning brief arrives, which services it names, and this device's notifications. */
export default async function BriefPage() {
  const [settings, push] = await Promise.all([
    apiGet("/brief/settings", briefSettingsResponseSchema),
    apiGet("/push/public-key", pushPublicKeyResponseSchema),
  ]);
  if (!settings || !push) redirect("/");

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <header className="flex items-center justify-between border-b border-zinc-200 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Morning brief</h1>
        <Link href="/list" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Back to list
        </Link>
      </header>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        Once a day, a notification lists new episodes of the shows you&apos;re watching, and says
        when a sequel to a show you finished, or a show on your Plan to Watch, starts airing. Tap it
        to open Chat, where you can reply &ldquo;watched it&rdquo;.
      </p>
      <Notifications publicKey={push.publicKey} />
      <BriefSettingsForm initial={settings} />
    </main>
  );
}
