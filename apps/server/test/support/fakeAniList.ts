import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** One AniList entry, in AniList's own response shape. */
export interface FakeAniListMedia {
  id: number;
  idMal: number | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  externalLinks: {
    siteId: number | null;
    site: string;
    url: string | null;
    type: string | null;
    isDisabled: boolean | null;
  }[];
}

export interface FakeAiring {
  mediaId: number;
  episode: number;
  /** Unix seconds, as AniList sends it. */
  airingAt: number;
}

interface GraphQlBody {
  query: string;
  variables: { ids?: number[]; page?: number; after?: number; before?: number };
}

const PER_PAGE = 50;

/**
 * A small stand-in for AniList's GraphQL API. It answers the two queries the app sends (media by
 * MAL ids, airing schedules in a time window) from in-memory data, pages like AniList, and can
 * fail the next requests on demand.
 */
export class FakeAniList {
  media: FakeAniListMedia[] = [];
  airings: FakeAiring[] = [];
  readonly requests: GraphQlBody[] = [];
  private readonly failures: { status: number; headers?: Record<string, string> }[] = [];

  private constructor(
    private readonly server: Server,
    readonly apiUrl: string,
  ) {}

  static async start(): Promise<FakeAniList> {
    const ref: { fake?: FakeAniList } = {};
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const fake = ref.fake;
        if (!fake) return;
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as GraphQlBody;
        fake.requests.push(body);
        const failure = fake.failures.shift();
        if (failure) {
          res.writeHead(failure.status, { "content-type": "application/json", ...failure.headers });
          res.end(JSON.stringify({ errors: [{ message: "fake failure" }], data: null }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: fake.answer(body) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    ref.fake = new FakeAniList(server, `http://127.0.0.1:${String(port)}/`);
    return ref.fake;
  }

  /** The next `count` requests fail with this status. */
  failNext(status: number, count = 1, headers?: Record<string, string>): void {
    for (let i = 0; i < count; i++) this.failures.push({ status, ...(headers ? { headers } : {}) });
  }

  reset(): void {
    this.media = [];
    this.airings = [];
    this.requests.length = 0;
    this.failures.length = 0;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  private answer(body: GraphQlBody): unknown {
    const { ids = [], page = 1 } = body.variables;
    if (body.query.includes("airingSchedules")) {
      const after = body.variables.after ?? -Infinity;
      const before = body.variables.before ?? Infinity;
      const matches = this.airings
        .filter((a) => ids.includes(a.mediaId) && a.airingAt > after && a.airingAt < before)
        .sort((a, b) => a.airingAt - b.airingAt);
      const { items, hasNextPage } = paginate(matches, page);
      return { Page: { pageInfo: { hasNextPage }, airingSchedules: items } };
    }
    const matches = this.media.filter((m) => m.idMal !== null && ids.includes(m.idMal));
    const { items, hasNextPage } = paginate(matches, page);
    return { Page: { pageInfo: { hasNextPage }, media: items } };
  }
}

function paginate<T>(items: T[], page: number): { items: T[]; hasNextPage: boolean } {
  const start = (page - 1) * PER_PAGE;
  return {
    items: items.slice(start, start + PER_PAGE),
    hasNextPage: items.length > start + PER_PAGE,
  };
}

/** A currently airing show with one streaming link, for tests that don't care about details. */
export function airingMedia(
  id: number,
  idMal: number,
  overrides: Partial<FakeAniListMedia> = {},
): FakeAniListMedia {
  return {
    id,
    idMal,
    format: "TV",
    status: "RELEASING",
    episodes: 12,
    startDate: { year: 2026, month: 7, day: 1 },
    nextAiringEpisode: null,
    externalLinks: [
      {
        siteId: 5,
        site: "Crunchyroll",
        url: `https://www.crunchyroll.com/series/${String(id)}`,
        type: "STREAMING",
        isDisabled: false,
      },
    ],
    ...overrides,
  };
}
