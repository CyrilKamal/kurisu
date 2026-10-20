import { redirect } from "next/navigation";

import { FinishProvider } from "@/components/FinishSheet";
import { ScoreStyleProvider } from "@/components/ScoreStyle";
import { ToastProvider } from "@/components/Toast";
import { getMe } from "@/lib/api";

import { NavBar } from "./NavBar";

/**
 * The signed-in screens (Today, List, Browse, Chat and You) share the NavBar, a bottom bar on
 * phones and a rail on the left from 1024px, one Toast, the sheet for finishing a show, and the
 * user's score style.
 */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Checked here, above each screen's loading skeleton, so someone logged out is sent to log in
  // straight away instead of seeing a screen load first. Pages reuse the same answer. An account
  // that hasn't accepted the current terms is asked once, before anything else.
  const me = await getMe();
  if (!me) redirect("/");
  if (!me.termsAccepted) redirect("/accept");
  return (
    <ScoreStyleProvider style={me.scoreStyle}>
      <ToastProvider>
        <FinishProvider>
          <div className="lg:pl-(--rail-width)">{children}</div>
          <NavBar />
        </FinishProvider>
      </ToastProvider>
    </ScoreStyleProvider>
  );
}
