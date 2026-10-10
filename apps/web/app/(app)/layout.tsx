import { ToastProvider } from "@/components/Toast";

import { NavBar } from "./NavBar";

/**
 * The signed-in screens (Today, List, Chat and You) share the NavBar, a bottom bar on phones and
 * a rail on the left from 1024px, and one Toast.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ToastProvider>
      <div className="lg:pl-(--rail-width)">{children}</div>
      <NavBar />
    </ToastProvider>
  );
}
