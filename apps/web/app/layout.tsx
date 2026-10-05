import type { Metadata, Viewport } from "next";

import { ServiceWorker } from "./ServiceWorker";

import "./globals.css";

export const metadata: Metadata = {
  title: "kurisu",
  description: "Your anime list, kept in sync by conversation.",
  // Lets iOS run it full-screen from the Home Screen, which web push there requires.
  appleWebApp: { capable: true, title: "kurisu", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
