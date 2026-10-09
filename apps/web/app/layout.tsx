import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";

import { ServiceWorker } from "./ServiceWorker";

import "./globals.css";

// The design system's two faces: Outfit for words, JetBrains Mono for every number.
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "kurisu",
  description: "Your anime list, kept in sync by conversation.",
  // Lets iOS run it full-screen from the Home Screen, which web push there requires.
  appleWebApp: { capable: true, title: "kurisu", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The canvas (bg); the app is dark only.
  themeColor: "#0d0e12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${outfit.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
