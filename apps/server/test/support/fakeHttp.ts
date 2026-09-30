import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

export interface FakeResponse {
  status?: number;
  body: unknown;
}

/**
 * A tiny recording HTTP server for provider tests: replies with queued responses in order and
 * keeps every request (with its parsed JSON body) for assertions.
 */
export class FakeHttpServer {
  readonly requests: RecordedRequest[] = [];
  private readonly queue: FakeResponse[] = [];

  private constructor(
    private readonly server: Server,
    readonly baseUrl: string,
  ) {}

  static async start(): Promise<FakeHttpServer> {
    const ref: { fake?: FakeHttpServer } = {};
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const fake = ref.fake;
        if (!fake) return;
        const text = Buffer.concat(chunks).toString("utf8");
        fake.requests.push({
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body: text ? (JSON.parse(text) as unknown) : undefined,
        });
        const next = fake.queue.shift() ?? { status: 500, body: { error: "no response queued" } };
        res
          .writeHead(next.status ?? 200, { "content-type": "application/json" })
          .end(JSON.stringify(next.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    ref.fake = new FakeHttpServer(server, `http://127.0.0.1:${String(port)}`);
    return ref.fake;
  }

  reply(...responses: FakeResponse[]): void {
    this.queue.push(...responses);
  }

  reset(): void {
    this.requests.length = 0;
    this.queue.length = 0;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}
