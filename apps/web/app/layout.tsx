import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";

import { ServiceWorker } from "./ServiceWorker";

import "./globals.css";

// The design system's faces: Inter for words and numbers, Source Serif 4 for show and screen
// titles, and JetBrains Mono only for what the agent prints (RunMeta, the trace, proposal ids).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-source-serif",
});
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
  // Edge to edge on phones with a notch or home indicator; the bars pad for the safe areas.
  viewportFit: "cover",
  // The canvas (bg); the app is dark only.
  themeColor: "#0d0e12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
