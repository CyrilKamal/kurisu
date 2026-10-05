import { ImageResponse } from "next/og";

import { brandMarkSvg, type BrandMarkVariant } from "./brandMark";

/** A PNG of the kurisu mark at `size` pixels square. */
export function brandIcon(variant: BrandMarkVariant, size: number): ImageResponse {
  const src = `data:image/svg+xml;base64,${Buffer.from(brandMarkSvg(variant)).toString("base64")}`;
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img */}
      <img src={src} width={size} height={size} alt="" />
    </div>,
    { width: size, height: size },
  );
}
