import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "kurisu",
  description: "Your anime list, kept in sync by conversation.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
