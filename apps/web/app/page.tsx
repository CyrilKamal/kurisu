import { meResponseSchema } from "@kurisu/shared";
import Image from "next/image";
import { redirect } from "next/navigation";

import { Banner } from "@/components/Banner";
import { apiGet } from "@/lib/api";
import { loginErrorMessage } from "@/lib/format";

export default async function LoginPage(props: PageProps<"/">) {
  const me = await apiGet("/me", meResponseSchema);
  if (me) redirect("/list");

  const { login_error: code } = await props.searchParams;
  const error = loginErrorMessage(typeof code === "string" ? code : undefined);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      {/* The mark stays as it's drawn today, until final art replaces it. */}
      <Image src="/icons/192.png" alt="" width={48} height={48} priority />
      <div>
        {/* The design system's `display` style: the wordmark, and nowhere else. */}
        <h1 className="font-serif text-[40px]/12 font-bold tracking-[-0.02em] text-ink">kurisu</h1>
        <p className="text-ink-muted">Your anime list, kept in sync by conversation.</p>
      </div>

      {error && <Banner level="error">{error}</Banner>}

      <div className="flex flex-col gap-2">
        {/* A full navigation, not a client-side Link: the server redirects to MAL's consent page. */}
        <a href="/api/auth/mal/login" className="k-btn k-btn--primary k-btn--lg k-btn--block">
          Log in with MyAnimeList
        </a>
        <p className="k-field__hint text-center">
          You&apos;ll approve access on myanimelist.net, then come right back.
        </p>
      </div>
    </main>
  );
}
