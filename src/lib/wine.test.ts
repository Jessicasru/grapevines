import { describe, expect, it } from "vitest";
import { isRecommended, searchWineries } from "./wine";

describe("recommended wineries", () => {
  it("featured wineries are recommended without notes", () => {
    expect(isRecommended({ featured: true, recommendations: [] })).toBe(true);
  });
  it("one public Go makes a winery recommended", () => {
    expect(isRecommended({ featured: false, recommendations: [{ verdict: "skip" }, { verdict: "go" }] })).toBe(true);
  });
  it("only Skip notes keep a winery in the base layer", () => {
    expect(isRecommended({ featured: false, recommendations: [{ verdict: "skip" }] })).toBe(false);
  });
});

describe("search", () => {
  it("matches names ignoring case and accents", () => {
    const list = [{ name: "Domaine Weinbach" }, { name: "Clos Sainte-Hune" }, { name: "Hügel" }];
    expect(searchWineries(list, "hugel").map((w) => w.name)).toEqual(["Hügel"]);
    expect(searchWineries(list, "DOMAINE").map((w) => w.name)).toEqual(["Domaine Weinbach"]);
  });
});
