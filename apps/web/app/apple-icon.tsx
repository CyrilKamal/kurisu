import { brandIcon } from "@/lib/brandIcon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The iOS home-screen icon. iOS rounds the corners itself, so it's full-bleed. */
export default function AppleIcon() {
  return brandIcon("maskable", size.width);
}
