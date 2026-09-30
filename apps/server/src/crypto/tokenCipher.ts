import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export interface TokenCipher {
  /**
   * Encrypts a secret for storage. `context` is bound as additional authenticated data, so a
   * ciphertext only decrypts under the same context (e.g. one user's refresh token cannot be
   * copied onto another user's row).
   */
  encrypt(plaintext: string, context: string): string;
  decrypt(payload: string, context: string): string;
}

export class TokenDecryptionError extends Error {
  constructor() {
    super("Stored secret could not be decrypted");
    this.name = "TokenDecryptionError";
  }
}

/**
 * AES-256-GCM with a random 96-bit IV per value. Output format: `v1:<iv>:<tag>:<ciphertext>`,
 * each part base64url. The version prefix leaves room for key rotation later.
 */
export function createTokenCipher(keyBase64: string): TokenCipher {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("Token encryption key must be 32 bytes");
  }

  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv, tag, ciphertext].map(encodePart).join(":");
    },

    decrypt(payload, context) {
      const [version, iv, tag, ciphertext, ...rest] = payload.split(":");
      if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
        throw new TokenDecryptionError();
      }
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new TokenDecryptionError();
      }
    },
  };
}

function encodePart(part: string | Buffer): string {
  return typeof part === "string" ? part : part.toString("base64url");
}
