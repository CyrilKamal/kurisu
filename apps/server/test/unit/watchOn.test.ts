import { describe, expect, it } from "vitest";

import { watchOn } from "../../src/brief/services.js";

const netflix = { siteId: 10, site: "Netflix", url: "https://www.netflix.com/title/1" };
const crunchyroll = { siteId: 5, site: "Crunchyroll", url: "https://www.crunchyroll.com/x" };
const amazon = { siteId: 261, site: "Amazon Prime Video", url: "https://www.amazon.com/x" };

describe("watchOn", () => {
  it("names only the services asked about, in the services' order, once each", () => {
    expect(watchOn([netflix, crunchyroll], ["netflix", "crunchyroll"])).toEqual([
      { service: "Crunchyroll", url: crunchyroll.url },
      { service: "Netflix", url: netflix.url },
    ]);
    expect(watchOn([netflix, crunchyroll], ["crunchyroll", "hidive"])).toEqual([
      { service: "Crunchyroll", url: crunchyroll.url },
    ]);
    // A service with two AniList sites counts once.
    expect(
      watchOn(
        [amazon, { ...amazon, siteId: 21, url: "https://www.primevideo.com/x" }],
        ["prime_video"],
      ),
    ).toEqual([{ service: "Prime Video", url: amazon.url }]);
  });

  it("says nothing when AniList lists none of them, and drops links that aren't https", () => {
    expect(watchOn([netflix], ["crunchyroll"])).toEqual([]);
    expect(watchOn([netflix], [])).toEqual([]);
    expect(watchOn([], ["netflix"])).toEqual([]);
    expect(watchOn([{ ...netflix, url: "http://www.netflix.com/title/1" }], ["netflix"])).toEqual([
      { service: "Netflix", url: null },
    ]);
  });
});
