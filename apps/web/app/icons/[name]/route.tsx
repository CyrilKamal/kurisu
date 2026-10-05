import type { BrandMarkVariant } from "@/lib/brandMark";
import { brandIcon } from "@/lib/brandIcon";

/** Icons the manifest and the service worker's notifications point at, by file name. */
const ICONS: Record<string, { variant: BrandMarkVariant; size: number }> = {
  "192.png": { variant: "tile", size: 192 },
  "512.png": { variant: "tile", size: 512 },
  "maskable-512.png": { variant: "maskable", size: 512 },
  "badge-96.png": { variant: "badge", size: 96 },
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_request: Request, ctx: RouteContext<"/icons/[name]">) {
  const icon = ICONS[(await ctx.params).name];
  if (!icon) return new Response(null, { status: 404 });
  return brandIcon(icon.variant, icon.size);
}
