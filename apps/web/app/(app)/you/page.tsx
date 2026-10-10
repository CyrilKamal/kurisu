import { meResponseSchema, statsResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon, type IconName } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";
import { goalProgress } from "@/lib/stats";

export const metadata: Metadata = { title: "You · kurisu" };

const SCREENS: { href: string; label: string; about: string; icon: IconName }[] = [
  { href: "/you/history", label: "History", about: "Every change, with Undo", icon: "undo" },
  { href: "/you/diary", label: "Diary", about: "What you said about shows", icon: "rename" },
  { href: "/you/stats", label: "Stats", about: "Your week, your year, your list", icon: "grid" },
  { href: "/you/taste", label: "Taste", about: "Genres you rate, and why you drop", icon: "star" },
  {
    href: "/you/friends",
    label: "Friends",
    about: "Taste matches and what they watch",
    icon: "chat",
  },
  {
    href: "/you/settings",
    label: "Settings",
    about: "Brief, services, sharing, account",
    icon: "bell",
  },
];

/** You: this year's goal up top, then everything about you and your list. */
export default async function YouPage() {
  const [me, stats] = await Promise.all([
    apiGet("/me", meResponseSchema),
    apiGet("/stats", statsResponseSchema),
  ]);
  if (!me || !stats) redirect("/");
  const { year } = stats;
  const progress = year.goal === null ? null : goalProgress(year.completed, year.goal);

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader title={me.user.malUsername} sub="on MyAnimeList" />

      {/* The screen's one hero metric (StatTile), opening Stats. */}
      <Link href="/you/stats" className="mt-6 block text-ink no-underline">
        <div className="k-metrics hover:bg-surface-raised">
          <div className="k-metric k-metric--hero">
            <p className="k-caps">Completed in {year.year}</p>
            <p className="k-metric__value">
              {year.completed}
              {year.goal !== null && <small>/{year.goal}</small>}
            </p>
            <p className="k-metric__label">
              {progress ? progress.label : "No goal yet: set one in Stats"}
            </p>
            {progress && (
              <div className="k-meter pt-2" aria-hidden="true">
                <div className="k-meter__track">
                  <div
                    className="k-meter__fill"
                    style={{ "--p": `${String(progress.percent)}%` } as React.CSSProperties}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Link>

      <nav aria-label="You" className="pt-6">
        <ul className="k-rows">
          {SCREENS.map((screen) => (
            <li key={screen.href}>
              <Link
                href={screen.href}
                className="flex min-h-(--tap-min) items-center gap-4 border-b border-line px-2 py-2 text-ink no-underline hover:bg-surface"
              >
                <span className="text-ink-faint">
                  <Icon name={screen.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{screen.label}</span>
                  <span className="k-field__hint block truncate">{screen.about}</span>
                </span>
                <span className="text-ink-faint">
                  <Icon name="chevron-left" className="rotate-180" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
