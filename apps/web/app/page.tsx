import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Banner } from "@/components/Banner";
import { Icon, type IconName } from "@/components/Icon";
import { DemoLog } from "@/components/landing/DemoLog";
import { Pricing } from "@/components/Pricing";
import { WaitlistForm } from "@/components/landing/WaitlistForm";
import { SignUpConsent } from "@/components/SignUpConsent";
import { SiteFooter } from "@/components/SiteFooter";
import { getMe, getSite } from "@/lib/api";
import { loginErrorMessage } from "@/lib/format";

export const metadata: Metadata = {
  title: "kurisu · your anime list, kept in sync by conversation",
  description:
    "Tell kurisu what you watched. It updates your MyAnimeList, briefs you on new episodes each morning, and picks what to watch next from your backlog.",
};

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "chat",
    title: "Updates by chat",
    text: "Write it the way you'd text a friend: “finished frieren, 2 more eps of jjk”. kurisu finds the shows on your list and writes the changes to MyAnimeList.",
  },
  {
    icon: "undo",
    title: "Every change can be undone",
    text: "Each write shows exactly what changed, with Undo. When it isn't sure which show you mean, it asks, and adding a show always waits for your OK.",
  },
  {
    icon: "bell",
    title: "A brief every morning",
    text: "New episodes of what you're watching and where to stream them on your services, plus a note when a sequel or a show you planned starts airing.",
  },
  {
    icon: "star",
    title: "Picks from your own backlog",
    text: "Ask what to watch tonight. It picks from your Plan to Watch and the shows you've started, fits your time and mood, and says why in one line.",
  },
  {
    icon: "list",
    title: "Your list, in your hands",
    text: "Edit any show, import a list from your notes, and keep your stats, a goal for the year and a journal of what you watched.",
  },
  {
    icon: "user",
    title: "Friends",
    text: "See how your taste matches your friends' and what they're watching. You choose what they see.",
  },
];

/** The questions, with who can join answered for how sign-up works now. */
const questions = (open: boolean): { q: string; a: React.ReactNode }[] => [
  {
    q: "Do I need a MyAnimeList account?",
    a: "Yes. kurisu keeps your MyAnimeList list in sync. You log in with MyAnimeList's own login, so kurisu never sees your password.",
  },
  {
    q: "Who can join?",
    a: open
      ? "Anyone 18 or older with a MyAnimeList account. Sign up free; new accounts get 14 days of Premium."
      : "Anyone 18 or older with a MyAnimeList account, by invite for now. Join the waitlist and an invite comes when there's a place.",
  },
  {
    q: "Will it change my list without asking?",
    a: "It writes the updates you tell it about, and shows each one with Undo. Adding a show, or anything it isn't sure about, waits for your OK.",
  },
  {
    q: "Which AI does it use?",
    a: "Google's Gemini, on the paid tier, which Google doesn't use to train its models. Every reply shows which model answered and how long it took.",
  },
  {
    q: "What does kurisu keep about me?",
    a: (
      <>
        A copy of your MyAnimeList list, your chats and your diary, so it can answer quickly. You
        can delete all of it at any time; your MyAnimeList list stays as it is.{" "}
        <Link className="k-link" href="/privacy">
          Privacy
        </Link>
      </>
    ),
  },
];

/**
 * kurisu's front door for anyone not logged in: what it does, a real-looking Chat exchange, the
 * plans, and the way in: signing up (18 or older, the terms accepted) when sign-up is open, or
 * the waitlist while it's invite-only. Everyone with an account logs in here.
 */
export default async function LandingPage(props: PageProps<"/">) {
  const me = await getMe();
  if (me) redirect("/today");

  const [{ login_error: code }, site] = await Promise.all([props.searchParams, getSite()]);
  const error = loginErrorMessage(typeof code === "string" ? code : undefined);
  const open = site.signup === "open";

  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-(--content-max) items-center justify-between gap-4 px-4 py-4">
        <span className="flex items-center gap-2">
          {/* The mark stays as it's drawn today, until final art replaces it. */}
          <Image src="/icons/192.png" alt="" width={24} height={24} loading="eager" />
          <span className="font-serif text-base/6 font-bold text-ink">kurisu</span>
        </span>
        {/* A full navigation, not a client-side Link: the server redirects to MAL's consent page. */}
        <a href="/api/auth/mal/login" className="k-btn k-btn--sm">
          Log in
        </a>
      </header>

      <main className="mx-auto flex max-w-(--content-max) flex-col gap-12 px-4 pb-12">
        {error && <Banner level="error">{error}</Banner>}

        <section className="flex flex-col gap-6 pt-8">
          <div>
            {/* The design system's `display` style: the wordmark, and nowhere else. */}
            <h1 className="font-serif text-[40px]/12 font-bold tracking-[-0.02em] text-ink">
              kurisu
            </h1>
            <p className="font-serif text-2xl/8 text-ink">
              Your anime list, kept in sync by conversation.
            </p>
          </div>
          <p className="text-ink-muted">
            Tell kurisu what you watched, in your own words. It updates your MyAnimeList, sends you
            a brief of new episodes each morning, and picks what to watch next from your backlog.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={open ? "#signup" : "#waitlist"} className="k-btn k-btn--primary k-btn--lg">
              {open ? "Sign up free" : "Join the waitlist"}
            </a>
            <a href="/api/auth/mal/login" className="k-btn k-btn--lg">
              {open ? "Log in" : "Have an invite? Log in"}
            </a>
          </div>
          <p className="k-field__hint">
            {open
              ? "For anyone 18 or older with a MyAnimeList account. New accounts get 14 days of Premium."
              : "Invite-only for now. For anyone 18 or older with a MyAnimeList account."}
          </p>
        </section>

        <DemoLog
          message="finished frieren and watched 2 more eps of jjk"
          reply="Done. Frieren is completed, and Jujutsu Kaisen is on ep 14 of 24."
          writes={[
            {
              title: "Sousou no Frieren",
              pictureUrl: "https://cdn.myanimelist.net/images/anime/1015/138006.webp",
              kind: "update",
              before: { status: "watching", episodesWatched: 26 },
              after: { status: "completed", episodesWatched: 28 },
              numEpisodes: 28,
            },
            {
              title: "Jujutsu Kaisen",
              pictureUrl: "https://cdn.myanimelist.net/images/anime/1171/109222.jpg",
              kind: "update",
              before: { episodesWatched: 12 },
              after: { episodesWatched: 14 },
              numEpisodes: 24,
            },
          ]}
          run={["Model: Flash-Lite", "2.4s", "4 tools", "1,840 tok", "progress-sync@17"]}
        />

        <section aria-labelledby="features">
          <h2 id="features" className="k-caps pb-2">
            What it does
          </h2>
          <ul className="grid gap-6 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex gap-4">
                <span className="pt-1 text-ink-muted">
                  <Icon name={feature.icon} />
                </span>
                <div>
                  <h3 className="font-serif text-base/6 font-semibold text-ink">{feature.title}</h3>
                  <p className="text-ink-muted">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="pricing">
          <h2 id="pricing" className="k-caps pb-2">
            Plans
          </h2>
          <Pricing />
        </section>

        {open ? (
          <section id="signup" aria-labelledby="signup-title" className="scroll-mt-4">
            <h2 id="signup-title" className="k-caps pb-2">
              Sign up
            </h2>
            <p className="pb-4 text-ink-muted">
              Free, with your MyAnimeList account. Your first 14 days are on Premium.
            </p>
            <div className="k-panel max-w-sm p-4">
              <SignUpConsent action="Sign up with MyAnimeList" />
            </div>
          </section>
        ) : (
          <section id="waitlist" aria-labelledby="waitlist-title" className="scroll-mt-4">
            <h2 id="waitlist-title" className="k-caps pb-2">
              Join the waitlist
            </h2>
            <p className="pb-4 text-ink-muted">
              kurisu is a small beta for now. Leave your email, and an invite comes when
              there&apos;s a place.
            </p>
            <WaitlistForm />
          </section>
        )}

        <section aria-labelledby="questions">
          <h2 id="questions" className="k-caps pb-2">
            Questions
          </h2>
          <dl className="flex flex-col gap-4">
            {questions(open).map(({ q, a }) => (
              <div key={q}>
                <dt className="font-serif text-base/6 font-semibold text-ink">{q}</dt>
                <dd className="m-0 text-ink-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <SiteFooter contactEmail={site.contactEmail} />
    </div>
  );
}
