import type { Metadata } from "next";
import Link from "next/link";

import { ContactLink, operatorName } from "@/components/legal";
import { LegalPage } from "@/components/LegalPage";
import { getSite } from "@/lib/api";

export const metadata: Metadata = { title: "Terms · kurisu" };

/** The rules of using kurisu, its plans, and what it does and doesn't promise. */
export default async function TermsPage() {
  const site = await getSite();
  const operator = operatorName(site.operator);
  return (
    <LegalPage title="Terms" updated="2026-10-19" contactEmail={site.contactEmail}>
      <p>
        These terms are between you and {operator}, who runs kurisu (&ldquo;we&rdquo;). Using kurisu
        means you accept them.
      </p>

      <h2>What kurisu is</h2>
      <p>
        kurisu keeps your MyAnimeList list in sync through a chat with an AI, and sends you briefs
        of new episodes and recommendations. It&apos;s a small beta: features may change, and it may
        sometimes be unavailable.
      </p>

      <h2>Who can use it</h2>
      <ul>
        <li>You must be 18 or older, with a MyAnimeList account.</li>
        <li>While kurisu is invite-only, creating an account takes an invite.</li>
        <li>You&apos;re responsible for what happens under your account.</li>
      </ul>

      <h2>The AI makes mistakes</h2>
      <p>
        kurisu&apos;s replies and changes come from an AI, and can be wrong. Every change it makes
        to your list is shown with Undo, and anything it isn&apos;t sure about waits for your OK.
        Check its changes; we aren&apos;t responsible for changes you didn&apos;t undo.
      </p>

      <h2>Your content</h2>
      <p>
        What you write, and your list, stay yours. You let kurisu store and process them to run the
        service, as the{" "}
        <Link className="k-link" href="/privacy">
          privacy page
        </Link>{" "}
        describes.
      </p>

      <h2>Fair use</h2>
      <p>
        Don&apos;t misuse kurisu: don&apos;t try to break or overload it, get around its limits,
        scrape it, or use it to harm anyone. We may suspend an account that does.
      </p>

      <h2>Plans and payments</h2>
      <ul>
        <li>
          Paid plans aren&apos;t on sale yet. When they are, they renew each month or year until you
          cancel. You can cancel at any time in Settings, and keep the plan until the end of the
          period you paid for.
        </li>
        <li>Stripe will sell the plans as the merchant of record, and handle payments.</li>
        <li>
          Prices and limits are shown before you pay. A price change is announced at least 30 days
          before it applies to you.
        </li>
        <li>
          Refunds follow the{" "}
          <Link className="k-link" href="/refunds">
            refunds page
          </Link>
          .
        </li>
      </ul>

      <h2>Other services</h2>
      <p>
        kurisu uses MyAnimeList, AniList and Google&apos;s Gemini. It isn&apos;t affiliated with or
        endorsed by MyAnimeList or AniList, and their own terms apply to how you use them.
      </p>

      <h2>Ending</h2>
      <p>
        You can delete your account at any time (You, then Settings). We may end the service, or an
        account that breaks these terms, with notice where we can.
      </p>

      <h2>No warranty</h2>
      <p>
        kurisu is provided as it is, without warranties. As far as the law allows, our liability is
        limited to what you paid for kurisu in the 12 months before a claim.
      </p>

      <h2>Changes and law</h2>
      <p>
        We post changes here and update the date above; account holders hear about any big change in
        the app. These terms are governed by the laws of California, USA.
      </p>

      <h2>Contact</h2>
      <p>
        Write to <ContactLink email={site.contactEmail} />.
      </p>
    </LegalPage>
  );
}
