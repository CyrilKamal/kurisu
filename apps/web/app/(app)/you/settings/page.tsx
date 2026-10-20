import {
  alertsResponseSchema,
  briefSettingsResponseSchema,
  calendarResponseSchema,
  pushPublicKeyResponseSchema,
} from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InstallPrompt } from "@/components/InstallPrompt";
import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet, getMe } from "@/lib/api";

import { BriefSettingsForm } from "./BriefSettingsForm";
import { CalendarFeed } from "./CalendarFeed";
import { DeleteAccount } from "./DeleteAccount";
import { EpisodeAlerts } from "./EpisodeAlerts";
import { LogoutButton } from "./LogoutButton";
import { Notifications } from "./Notifications";
import { SharingSwitch } from "./SharingSwitch";
import { TitleLanguagePicker } from "./TitleLanguagePicker";

export const metadata: Metadata = { title: "Settings · kurisu" };

/**
 * Everything you set once: this device's notifications, the morning brief and your streaming
 * services, episode alerts, the calendar feed, what friends see, and your account.
 */
export default async function SettingsPage() {
  const [me, settings, push, calendar, alerts] = await Promise.all([
    getMe(),
    apiGet("/brief/settings", briefSettingsResponseSchema),
    apiGet("/push/public-key", pushPublicKeyResponseSchema),
    apiGet("/calendar", calendarResponseSchema),
    apiGet("/alerts", alertsResponseSchema),
  ]);
  if (!me || !settings || !push || !calendar || !alerts) redirect("/");

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
      <EpisodeAlerts initial={alerts} />
      <CalendarFeed initial={calendar} />
      <SharingSwitch initial={me.user.shareActivity} />
      <TitleLanguagePicker initial={me.titleLanguage} />

      <section className="pt-6">
        <h2 className="k-caps pb-2">Install</h2>
        <div className="k-panel flex flex-col gap-2 p-4">
          <InstallPrompt />
        </div>
      </section>

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
