import type { Metadata } from "next";

import { ContactLink } from "@/components/legal";
import { LegalPage } from "@/components/LegalPage";
import { getSite } from "@/lib/api";

export const metadata: Metadata = { title: "Refunds · kurisu" };

/** How refunds work for kurisu's paid plans. */
export default async function RefundsPage() {
  const site = await getSite();
  const contact = <ContactLink email={site.contactEmail} />;
  return (
    <LegalPage title="Refunds" updated="2026-10-19" contactEmail={site.contactEmail}>
      <p>Paid plans aren&apos;t on sale yet. This is how refunds will work when they are.</p>
      <ul>
        <li>
          <strong>Within 14 days of a payment</strong> (your first one, or a renewal), you can ask
          for a full refund. No reason needed.
        </li>
        <li>
          <strong>After 14 days,</strong> you can cancel at any time and keep your plan until the
          end of the period you paid for. That period isn&apos;t refunded, except where the law says
          it must be.
        </li>
        <li>
          <strong>To ask,</strong> write to {contact} from the address you paid with.
        </li>
        <li>Refunds go back to the card you paid with, usually within 5 to 10 days.</li>
      </ul>
    </LegalPage>
  );
}
