"use client";

import { useIsBrowser } from "@/lib/useIsBrowser";
import { broadcastLabel } from "@/lib/showExtras";

/**
 * When MAL says a new episode airs in Japan, and when that is on this device's clock:
 * "Saturdays 23:00 JST · Sat 4:00 PM yours". The local half is drawn in the browser.
 */
export function BroadcastLine({ day, time }: { day: string; time: string | null }) {
  const browser = useIsBrowser();
  const label = broadcastLabel(day, time, browser ? undefined : "Asia/Tokyo");
  return <span>{label}</span>;
}
