import { brandIcon } from "@/lib/brandIcon";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** The browser-tab icon. */
export default function Icon() {
  return brandIcon("tile", size.width);
}
