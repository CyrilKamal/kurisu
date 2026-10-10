import { friendLinkCheckSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";

import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";

import { AddFriend } from "./AddFriend";

export const metadata: Metadata = { title: "Add a friend · kurisu" };

/** Where someone's friend link lands: whose it is, and one tap to become friends. */
export default async function FriendLinkPage(props: PageProps<"/friend/[code]">) {
  const { code } = await props.params;
  // Null when logged out; an unknown or replaced link is a 404.
  const link = await apiGet(`/friends/links/${encodeURIComponent(code)}`, friendLinkCheckSchema);

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <ScreenHeader title="Add a friend" />
      <div className="k-panel mt-6 flex flex-col gap-4 p-4">
        {!link ? (
          <>
            <p className="text-ink">
              Log in to kurisu, then open this link again. kurisu is invite-only, so you need an
              account first.
            </p>
            <a href="/api/auth/mal/login" className="k-btn k-btn--primary self-start">
              Log in with MyAnimeList
            </a>
          </>
        ) : link.self ? (
          <p className="text-ink">
            This is your own friend link. Send it to someone on kurisu to become friends.
          </p>
        ) : link.alreadyFriends ? (
          <p className="text-ink">
            You and <span className="font-semibold">{link.owner}</span> are already friends.{" "}
            <Link href="/you/friends" className="k-link">
              See your friends
            </Link>
          </p>
        ) : (
          <>
            <p className="text-ink">
              Add <span className="font-semibold">{link.owner}</span> as a friend? You&apos;ll see
              each other&apos;s taste match, and what each of you watches if you share it.
            </p>
            <AddFriend code={code} />
          </>
        )}
      </div>
    </main>
  );
}
