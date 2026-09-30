import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createTokenCipher, TokenDecryptionError } from "../../src/crypto/tokenCipher.js";

const key = randomBytes(32).toString("base64");
const cipher = createTokenCipher(key);

describe("tokenCipher", () => {
  it("round-trips a secret", () => {
    const payload = cipher.encrypt("access-token-value", "ctx:1");

    expect(payload).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(payload).not.toContain("access-token-value");
    expect(cipher.decrypt(payload, "ctx:1")).toBe("access-token-value");
  });

  it("uses a fresh IV each time", () => {
    expect(cipher.encrypt("same", "ctx")).not.toBe(cipher.encrypt("same", "ctx"));
  });

  it("refuses to decrypt under a different context", () => {
    const payload = cipher.encrypt("secret", "mal_refresh_token:user-a");

    expect(() => cipher.decrypt(payload, "mal_refresh_token:user-b")).toThrow(TokenDecryptionError);
  });

  it("detects tampering", () => {
    const [version, iv, tag, ciphertext] = cipher.encrypt("secret", "ctx").split(":");
    const flipped = Buffer.from(ciphertext ?? "", "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;

    expect(() =>
      cipher.decrypt([version, iv, tag, flipped.toString("base64url")].join(":"), "ctx"),
    ).toThrow(TokenDecryptionError);
  });

  it("fails with a different key", () => {
    const other = createTokenCipher(randomBytes(32).toString("base64"));

    expect(() => other.decrypt(cipher.encrypt("secret", "ctx"), "ctx")).toThrow(
      TokenDecryptionError,
    );
  });

  it("rejects malformed payloads without leaking details", () => {
    for (const bad of ["", "v1", "v2:a:b:c", "v1:a:b:c:d", "plaintext-token"]) {
      expect(() => cipher.decrypt(bad, "ctx")).toThrow(TokenDecryptionError);
    }
  });

  it("requires a 32-byte key", () => {
    expect(() => createTokenCipher(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
