import type { MetadataRoute } from "next";

/** Makes kurisu installable; push notifications on iOS need it on the Home Screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "kurisu",
    short_name: "kurisu",
    description: "Your anime list, kept in sync by conversation.",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    background_color: "#0d0e12",
    theme_color: "#0d0e12",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
