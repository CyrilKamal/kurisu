import { describe, expect, it } from "vitest";

import {
  CODE_CHALLENGE_METHOD,
  codeChallengeFor,
  createCodeVerifier,
  createState,
} from "../../src/mal/pkce.js";

// RFC 7636: verifier = 43*128 unreserved characters.
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

describe("PKCE (plain, as MAL requires)", () => {
  it("uses the plain method", () => {
    expect(CODE_CHALLENGE_METHOD).toBe("plain");
  });

  it("creates verifiers within MAL's 43–128 character limit, using only unreserved characters", () => {
    for (let i = 0; i < 100; i++) {
      const verifier = createCodeVerifier();
      expect(verifier).toMatch(UNRESERVED);
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    }
  });

  it("makes the challenge identical to the verifier", () => {
    const verifier = createCodeVerifier();
    expect(codeChallengeFor(verifier)).toBe(verifier);
  });

  it("never repeats verifiers or states", () => {
    const verifiers = new Set(Array.from({ length: 1000 }, createCodeVerifier));
    const states = new Set(Array.from({ length: 1000 }, createState));
    expect(verifiers.size).toBe(1000);
    expect(states.size).toBe(1000);
  });
});
