import { invitesResponseSchema, meResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { InviteFriends } from "./InviteFriends";

export const metadata: Metadata = { title: "Friends · kurisu" };

/** For now, the owner's invites: new one-time links, and what happened to the last ones. */
export default async function FriendsPage() {
  const me = await apiGet("/me", meResponseSchema);
  if (!me) redirect("/");
  if (!me.user.isOwner) notFound();
  const invites = await apiGet("/invites", invitesResponseSchema);
  if (!invites) redirect("/");

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <ScreenHeader
        title="Friends"
        sub="invite people to your kurisu"
        actions={
          <Link href="/list" className="k-btn k-btn--ghost">
            Back to list
          </Link>
        }
      />
      <p className="k-field__hint pt-4">
        kurisu is invite-only. Each link lets one person join with their MyAnimeList account, and
        works for a week.
      </p>
      <InviteFriends initial={invites.invites} />
    </main>
  );
}
