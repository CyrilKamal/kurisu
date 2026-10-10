import { FinishProvider } from "@/components/FinishSheet";
import { ToastProvider } from "@/components/Toast";

import { NavBar } from "./NavBar";

/**
 * The signed-in screens (Today, List, Chat and You) share the NavBar, a bottom bar on phones and
 * a rail on the left from 1024px, one Toast, and the sheet for finishing a show.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ToastProvider>
      <FinishProvider>
        <div className="lg:pl-(--rail-width)">{children}</div>
        <NavBar />
      </FinishProvider>
    </ToastProvider>
  );
}
