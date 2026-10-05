import { createDecipheriv, createECDH, createHmac, randomBytes, type ECDH } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface ReceivedPush {
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** A browser's side of a push subscription: the keys a real browser would generate. */
export interface FakeBrowser {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  /** Decrypts a message sent to this subscription (RFC 8291, aes128gcm). */
  decrypt(body: Buffer): string;
}

/**
 * A stand-in for a browser push service (FCM, Mozilla, Apple). Records each message and replies
 * with a status per endpoint path (201 unless told otherwise).
 */
export class FakePushService {
  readonly received: ReceivedPush[] = [];
  private readonly statuses = new Map<string, number>();

  private constructor(
    private readonly server: Server,
    readonly origin: string,
  ) {}

  static async start(): Promise<FakePushService> {
    const ref: { fake?: FakePushService } = {};
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const fake = ref.fake;
        if (!fake) return;
        const path = req.url ?? "";
        fake.received.push({ path, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(fake.statuses.get(path) ?? 201).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    ref.fake = new FakePushService(server, `http://127.0.0.1:${String(port)}`);
    return ref.fake;
  }

  /** Makes messages to this endpoint path get `status`, e.g. 410 for an expired subscription. */
  respond(path: string, status: number): void {
    this.statuses.set(path, status);
  }

  /** A new browser subscription with real keys, at `/push/<name>` on this service. */
  browser(name: string): FakeBrowser {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const authSecret = randomBytes(16);
    return {
      subscription: {
        endpoint: `${this.origin}/push/${name}`,
        keys: {
          p256dh: ecdh.getPublicKey().toString("base64url"),
          auth: authSecret.toString("base64url"),
        },
      },
      decrypt: (body) => decryptAes128gcm(body, ecdh, authSecret),
    };
  }

  reset(): void {
    this.received.length = 0;
    this.statuses.clear();
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** RFC 8291 / RFC 8188 decryption, as a browser does it, for a single-record message. */
function decryptAes128gcm(body: Buffer, browserKeys: ECDH, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const keyIdLength = body.readUInt8(20);
  const serverPublicKey = body.subarray(21, 21 + keyIdLength);
  const record = body.subarray(21 + keyIdLength);

  const sharedSecret = browserKeys.computeSecret(serverPublicKey);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    browserKeys.getPublicKey(),
    serverPublicKey,
  ]);
  const ikm = hmac(hmac(authSecret, sharedSecret), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  // The plaintext ends with a 0x02 delimiter followed by zero padding.
  const end = padded.lastIndexOf(2);
  return padded.subarray(0, end).toString("utf8");
}
