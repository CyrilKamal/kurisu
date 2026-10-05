import { describe, expect, it } from "vitest";

import { isAllowedPushEndpoint } from "../../src/push/send.js";

describe("isAllowedPushEndpoint", () => {
  it("accepts the browsers' push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGuQyavXut",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
      "https://api.push.apple.com/3/device/abc",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc", // not https
      "https://fcm.googleapis.com:444/fcm/send/abc", // odd port
      "https://fcm.googleapis.com.evil.example/x",
      "https://notify.windows.com.evil.example/x",
      "https://evilnotify.windows.com/x", // not a subdomain
      "https://127.0.0.1/push",
      "https://localhost/push",
      "file:///etc/passwd",
      "",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it("accepts extra origins only exactly", () => {
    expect(isAllowedPushEndpoint("http://127.0.0.1:4010/push/a", ["http://127.0.0.1:4010"])).toBe(
      true,
    );
    expect(isAllowedPushEndpoint("http://127.0.0.1:4011/push/a", ["http://127.0.0.1:4010"])).toBe(
      false,
    );
  });
});
