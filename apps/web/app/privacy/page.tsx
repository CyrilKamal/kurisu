import type { Metadata } from "next";
import Link from "next/link";

import { ContactLink, operatorName } from "@/components/legal";
import { LegalPage } from "@/components/LegalPage";
import { getSite } from "@/lib/api";

export const metadata: Metadata = { title: "Privacy · kurisu" };

/** What kurisu keeps about people, why, who else sees it, and how to delete it. */
export default async function PrivacyPage() {
  const site = await getSite();
  const contact = <ContactLink email={site.contactEmail} />;
  return (
    <LegalPage title="Privacy" updated="2026-10-19" contactEmail={site.contactEmail}>
      <p>
        kurisu is a small app run by {operatorName(site.operator)} (&ldquo;we&rdquo;). This page
        says what kurisu keeps about you, why, who else sees it, and how to delete it. Questions go
        to {contact}.
      </p>

      <h2>If you join the waitlist</h2>
      <ul>
        <li>
          We keep your email and, if you give it, your MyAnimeList username, only to send you an
          invite. We don&apos;t send anything else to that address or share it.
        </li>
        <li>
          To leave, use the link shown when you join, or write to {contact}. Your entry is deleted.
        </li>
      </ul>

      <h2>If you have an account</h2>
      <p>kurisu keeps:</p>
      <ul>
        <li>
          Your MyAnimeList username and account number, and a copy of your anime list: titles,
          status, episodes, scores and dates. kurisu reads it from MyAnimeList when you log in and
          after it writes a change.
        </li>
        <li>
          Your MyAnimeList login tokens, encrypted, so kurisu can update your list. kurisu never
          sees your password.
        </li>
        <li>
          What you send in Chat and kurisu&apos;s replies, the diary notes it keeps from them, why
          you dropped shows, your taste profile, and your settings (the brief&apos;s time, your time
          zone, your streaming services).
        </li>
        <li>
          Each change kurisu makes to your list, with the value before it, so it can be undone.
        </li>
        <li>
          A log of each request to the AI: which model and prompt answered, the tools it used and
          what they returned, how long it took and how many tokens it used. It&apos;s used to run
          kurisu, keep its costs in check and fix its mistakes.
        </li>
        <li>Your browser&apos;s push address, if you allow notifications.</li>
        <li>Your friends on kurisu, and the invites you made.</li>
      </ul>
      <p>
        All of it is used to run the features you use. We don&apos;t sell it, show ads, or use it to
        train AI models.
      </p>

      <h2>Who else sees it</h2>
      <ul>
        <li>
          <strong>Google (the Gemini API).</strong> kurisu sends your messages, and the parts of
          your list needed to answer them, to Google&apos;s Gemini, on its paid tier. Google
          doesn&apos;t use paid-tier data to improve its products, and keeps it for up to 55 days to
          detect abuse.
        </li>
        <li>
          <strong>MyAnimeList</strong> receives the changes kurisu makes to your list.
        </li>
        <li>
          <strong>AniList</strong> is asked for airing schedules, streaming links and show details.
          kurisu sends it show identifiers, never your data.
        </li>
        <li>
          <strong>Our hosting provider</strong> stores kurisu&apos;s database and its backups.
        </li>
        <li>
          <strong>Payments,</strong> once paid plans are on sale, are handled by Stripe as the
          seller. kurisu never sees your card number.
        </li>
        <li>
          <strong>Your friends on kurisu</strong> see your taste match and, unless you turn sharing
          off in Settings, what you watch: episodes, finishes, scores and drops. They see a diary
          note only if you share it.
        </li>
        <li>
          <strong>When something goes wrong</strong> (an error, a change you undo soon after, or a
          reply you report), {operatorName(site.operator)} may read that conversation to fix kurisu,
          and may keep it privately as a test case.
        </li>
      </ul>

      <h2>Keeping and deleting it</h2>
      <ul>
        <li>kurisu keeps your data while you have an account.</li>
        <li>
          Deleting your account (You, then Settings) deletes everything kurisu holds about you at
          once. Your MyAnimeList list stays as it is.
        </li>
        <li>Backups of the database are kept for up to 30 days, then deleted.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data, have it corrected, or have it deleted, by writing to{" "}
        {contact}. If you&apos;re in the EU or the UK, you can also object to how it&apos;s used,
        and complain to your data protection authority.
      </p>

      <h2>Cookies and your browser</h2>
      <ul>
        <li>
          One cookie keeps you logged in. There are no ad or tracking cookies, and kurisu
          doesn&apos;t follow you around other sites, so a Do Not Track setting changes nothing.
        </li>
        <li>
          Your browser keeps a copy of your list so it works offline, which logging out clears, and
          your recent searches.
        </li>
      </ul>

      <h2>Age, and where it&apos;s stored</h2>
      <p>
        kurisu is for people 18 or older. Its data is stored in the United States. See also the{" "}
        <Link className="k-link" href="/terms">
          terms
        </Link>
        .
      </p>

      <h2>Changes</h2>
      <p>
        When this page changes, so does the date above, and account holders hear about any big
        change in the app.
      </p>
    </LegalPage>
  );
}
