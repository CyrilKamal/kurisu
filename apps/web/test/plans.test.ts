import { PLAN_CATALOG } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import { priceLabel, yearlySaving } from "../lib/plans";

const [free, premium, pro] = PLAN_CATALOG;

describe("plan prices", () => {
  it("shows a year's price with what it comes to a month, and a month's alone", () => {
    expect(priceLabel(premium, "year")).toEqual({
      price: "$24.99",
      per: "a year",
      note: "$2.08 a month",
    });
    expect(priceLabel(premium, "month")).toEqual({ price: "$2.99", per: "a month", note: null });
    expect(priceLabel(pro, "year")).toEqual({
      price: "$49.99",
      per: "a year",
      note: "$4.16 a month",
    });
    expect(priceLabel(free, "year")).toEqual({ price: "$0", per: "forever", note: null });
  });

  it("says how much a year saves", () => {
    expect(yearlySaving(premium)).toBe(30);
    expect(yearlySaving(pro)).toBe(30);
    expect(yearlySaving(free)).toBe(0);
  });
});
