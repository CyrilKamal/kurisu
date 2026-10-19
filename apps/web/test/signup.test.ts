import { TERMS_VERSION } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import { loginErrorMessage } from "../lib/format";
import { signUpUrl } from "../lib/signup";

describe("signing up", () => {
  it("logs in with the terms version accepted, and the invite when there is one", () => {
    expect(signUpUrl()).toBe(`/api/auth/mal/login?consent=${TERMS_VERSION}`);
    expect(signUpUrl("ab_c-1")).toBe(`/api/auth/mal/login?consent=${TERMS_VERSION}&invite=ab_c-1`);
  });

  it("says what to do when the boxes weren't ticked", () => {
    expect(loginErrorMessage("consent_needed")).toMatch(/tick both boxes/);
  });
});
