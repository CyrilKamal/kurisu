import { inviteCodeResponseSchema, meResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";

import { Banner } from "@/components/Banner";
import { apiGet, apiGetPublic } from "@/lib/api";

export const metadata: Metadata = { title: "You're invited · kurisu" };

/** Where an invite link lands: who sent it, what joining means, and the way in. */
export default async function InvitePage(props: PageProps<"/invite/[code]">) {
  const me = await apiGet("/me", meResponseSchema);
  if (me) redirect("/list");

  const { code } = await props.params;
  const invite = await apiGetPublic(
    `/invites/code/${encodeURIComponent(code)}`,
    inviteCodeResponseSchema,
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-8">
      <Image src="/icons/192.png" alt="" width={48} height={48} priority />
      <div>
        <h1 className="font-serif text-[40px]/12 font-bold tracking-[-0.02em] text-ink">kurisu</h1>
        <p className="text-ink-muted">Your anime list, kept in sync by conversation.</p>
      </div>

      {invite ? (
        <>
          <p className="text-ink">
            <span className="font-semibold">{invite.inviter}</span> invited you. Tell kurisu what
            you watched and it updates your MyAnimeList, sends a morning brief of new episodes, and
            picks what to watch next.
          </p>

          <section className="k-panel p-4">
            <h2 className="k-caps pb-2">Before you join</h2>
            <ul className="flex list-disc flex-col gap-2 pl-4 text-ink-muted">
              <li>
                kurisu is a small beta that {invite.inviter} runs on their own computer. You need to
                be 18 or older.
              </li>
              <li>
                It keeps a copy of your MyAnimeList list, your chats and your diary, so it can
                answer quickly. MyAnimeList&apos;s login gives it your list, never your password.
              </li>
              <li>
                You and {invite.inviter} become friends: you see each other&apos;s taste match, and
                what each of you watches (episodes, finishes, scores and drops). You can turn that
                off, and your chats and diary stay private.
              </li>
              <li>
                Google&apos;s Gemini reads what you send kurisu, on the paid tier, which Google
                doesn&apos;t train on.
              </li>
              <li>
                When kurisu gets something wrong (an error, an Undo, or a reply you report),{" "}
                {invite.inviter} may read that conversation to fix it. It stays private.
              </li>
              <li>
                You can delete everything kurisu holds about you at any time, under List, then
                Account. Your MyAnimeList list stays as it is.
              </li>
            </ul>
          </section>

          <div className="flex flex-col gap-2">
            {/* A full navigation: the server redirects to MAL's consent page. */}
            <a
              href={`/api/auth/mal/login?invite=${encodeURIComponent(code)}`}
              className="k-btn k-btn--primary k-btn--lg k-btn--block"
            >
              Join with MyAnimeList
            </a>
            <p className="k-field__hint text-center">
              You&apos;ll approve access on myanimelist.net, then come right back.
            </p>
          </div>
        </>
      ) : (
        <Banner level="error">
          This invite has expired or was already used. Ask whoever sent it for a new link.
        </Banner>
      )}
    </main>
  );
}
