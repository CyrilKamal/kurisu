import { briefSettingsResponseSchema, pushPublicKeyResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
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
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <ScreenHeader
        title="Morning brief"
        sub="new episodes, premieres and your week, once a day"
        actions={
          <Link href="/list" className="k-btn k-btn--ghost">
            Back to list
          </Link>
        }
      />
      <p className="k-field__hint pt-4">
        Once a day, a notification lists new episodes of the shows you&apos;re watching, and says
        when a sequel to a show you finished, or a show on your Plan to Watch, starts airing. On
        Sundays it sums up your week. Tap it to open Chat, where you can reply &ldquo;watched
        it&rdquo;.
      </p>
      <Notifications publicKey={push.publicKey} />
      <BriefSettingsForm initial={settings} />
    </main>
  );
}
