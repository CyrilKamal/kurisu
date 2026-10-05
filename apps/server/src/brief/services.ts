/**
 * The streaming services a user can pick, and the AniList site ids each one covers. The ids and
 * labels mirror STREAMING_SERVICES in @kurisu/shared (a contract test keeps them equal). The
 * brief only ever names a service from this list, so an unknown site can't show up in it.
 */
export const STREAMING_SERVICES = [
  { id: "crunchyroll", label: "Crunchyroll", anilistSiteIds: [5] },
  { id: "netflix", label: "Netflix", anilistSiteIds: [10] },
  { id: "hidive", label: "HIDIVE", anilistSiteIds: [20] },
  { id: "hulu", label: "Hulu", anilistSiteIds: [7] },
  { id: "disney_plus", label: "Disney+", anilistSiteIds: [118] },
  { id: "prime_video", label: "Prime Video", anilistSiteIds: [21, 261] },
  { id: "max", label: "Max", anilistSiteIds: [211] },
  { id: "apple_tv", label: "Apple TV+", anilistSiteIds: [250] },
  { id: "tubi", label: "Tubi", anilistSiteIds: [30] },
  { id: "youtube", label: "YouTube", anilistSiteIds: [13] },
  { id: "bilibili_tv", label: "Bilibili TV", anilistSiteIds: [119] },
  { id: "retrocrush", label: "RetroCrush", anilistSiteIds: [27] },
  { id: "adult_swim", label: "Adult Swim", anilistSiteIds: [28] },
] as const;

export type StreamingServiceId = (typeof STREAMING_SERVICES)[number]["id"];

export const STREAMING_SERVICE_IDS: readonly string[] = STREAMING_SERVICES.map((s) => s.id);

/** AniList site id → the label of the user's service that covers it. */
export function siteLabels(serviceIds: readonly string[]): Map<number, string> {
  const labels = new Map<number, string>();
  for (const service of STREAMING_SERVICES) {
    if (!serviceIds.includes(service.id)) continue;
    for (const siteId of service.anilistSiteIds) labels.set(siteId, service.label);
  }
  return labels;
}
