import { redirect } from "next/navigation";

import { FinishProvider } from "@/components/FinishSheet";
import { ToastProvider } from "@/components/Toast";
import { getMe } from "@/lib/api";

import { NavBar } from "./NavBar";

/**
 * The signed-in screens (Today, List, Chat and You) share the NavBar, a bottom bar on phones and
 * a rail on the left from 1024px, one Toast, and the sheet for finishing a show.
 */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Checked here, above each screen's loading skeleton, so someone logged out is sent to log in
  // straight away instead of seeing a screen load first. Pages reuse the same answer.
  if (!(await getMe())) redirect("/");
  return (
    <ToastProvider>
      <FinishProvider>
        <div className="lg:pl-(--rail-width)">{children}</div>
        <NavBar />
      </FinishProvider>
    </ToastProvider>
  );
}
