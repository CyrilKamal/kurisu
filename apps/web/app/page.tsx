import { meResponseSchema } from "@kurisu/shared";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";
import { loginErrorMessage } from "@/lib/format";

export default async function LoginPage(props: PageProps<"/">) {
  const me = await apiGet("/me", meResponseSchema);
  if (me) redirect("/list");

  const { login_error: code } = await props.searchParams;
  const error = loginErrorMessage(typeof code === "string" ? code : undefined);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-3xl font-semibold tracking-tight">kurisu</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Your anime list, kept in sync by conversation.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      )}

      {/* A full navigation, not a client-side Link: the server redirects to MAL's consent page. */}
      <a
        href="/api/auth/mal/login"
        className="mt-8 inline-flex h-11 items-center justify-center rounded-lg bg-blue-700 px-4 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        Log in with MyAnimeList
      </a>
      <p className="mt-3 text-center text-xs text-zinc-500">
        You&apos;ll approve access on myanimelist.net, then come right back.
      </p>
    </main>
  );
}
