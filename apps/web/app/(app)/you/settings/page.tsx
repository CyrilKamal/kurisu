import {
  briefSettingsResponseSchema,
  meResponseSchema,
  pushPublicKeyResponseSchema,
} from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { BriefSettingsForm } from "./BriefSettingsForm";
import { DeleteAccount } from "./DeleteAccount";
import { LogoutButton } from "./LogoutButton";
import { Notifications } from "./Notifications";
import { SharingSwitch } from "./SharingSwitch";

export const metadata: Metadata = { title: "Settings · kurisu" };

/**
 * Everything you set once: this device's notifications, the morning brief and your streaming
 * services, what friends see, and your account.
 */
export default async function SettingsPage() {
  const [me, settings, push] = await Promise.all([
    apiGet("/me", meResponseSchema),
    apiGet("/brief/settings", briefSettingsResponseSchema),
    apiGet("/push/public-key", pushPublicKeyResponseSchema),
  ]);
  if (!me || !settings || !push) redirect("/");

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader title="Settings" sub={`${me.user.malUsername} on MyAnimeList`} back="/you" />
      <p className="k-field__hint pt-4">
        Once a day, a notification lists new episodes of the shows you&apos;re watching, and says
        when a sequel to a show you finished, or a show on your Plan to Watch, starts airing. On
        Sundays it sums up your week. Tap it to open Chat, where you can reply &ldquo;watched
        it&rdquo;.
      </p>
      <Notifications publicKey={push.publicKey} />
      <BriefSettingsForm initial={settings} />
      <SharingSwitch initial={me.user.shareActivity} />

      <section className="pt-6">
        <h2 className="k-caps pb-2">This device</h2>
        <div className="k-panel flex items-center justify-between gap-4 p-4">
          <p className="text-ink-muted">
            Logging out also stops this browser&apos;s notifications.
          </p>
          <LogoutButton />
        </div>
      </section>
      <DeleteAccount />
    </main>
  );
}
