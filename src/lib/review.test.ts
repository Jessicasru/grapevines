import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { approvableIn, filterWineries, parseWineryEdit, reviewCounts, sourceLinks } from "./review";

const w = (review_status: string, review_flags: string[], region_id = "alsace") => ({
  review_status,
  review_flags,
  region_id,
});
const list = [
  w("pending", []),
  w("pending", ["no_website"]),
  w("pending", ["no_website", "single_source"]),
  w("approved", []),
  w("rejected", ["not_winery_name"]),
  w("pending", [], "mosel"),
  w("pending", ["possible_duplicate"], "mosel"),
];

describe("review filters", () => {
  it("finds flagged pending wineries in one region", () => {
    const found = filterWineries(list, {
      status: "pending",
      flagged: "flagged",
      reason: "any",
      region: "alsace",
    });
    expect(found).toEqual([list[1], list[2]]);
  });
  it("filters by flag reason", () => {
    expect(
      filterWineries(list, {
        status: "all",
        flagged: "all",
        reason: "single_source",
        region: "all",
      }),
    ).toEqual([list[2]]);
  });
  it("shows everything when no filter is set", () => {
    expect(
      filterWineries(list, { status: "all", flagged: "all", reason: "any", region: "all" }),
    ).toHaveLength(list.length);
  });
});

describe("approve all unflagged", () => {
  it("counts only pending wineries without flags in that region", () => {
    expect(approvableIn(list, "alsace")).toEqual([list[0]]);
    expect(approvableIn(list, "mosel")).toEqual([list[5]]);
  });
});

describe("review counts", () => {
  it("counts each status, each flag and the unflagged", () => {
    const counts = reviewCounts(list);
    expect(counts.status).toEqual({ pending: 5, approved: 1, rejected: 1 });
    expect(counts.flag).toEqual({
      not_winery_name: 1,
      no_website: 2,
      single_source: 1,
      possible_duplicate: 1,
    });
    expect(counts.unflagged).toBe(3);
  });
});

describe("source links", () => {
  it("links OpenStreetMap and DATAtourisme records", () => {
    expect(
      sourceLinks([
        { source: "osm", source_id: "node/123" },
        { source: "datatourisme", source_id: "https://data.datatourisme.fr/5/abc" },
      ]),
    ).toEqual([
      { label: "OpenStreetMap", id: "node/123", url: "https://www.openstreetmap.org/node/123" },
      {
        label: "DATAtourisme",
        id: "https://data.datatourisme.fr/5/abc",
        url: "https://data.datatourisme.fr/5/abc",
      },
    ]);
  });
  it("gives no link for an id it can't trust", () => {
    expect(
      sourceLinks([{ source: "osm", source_id: "javascript:alert(1)" }])[0]?.url,
    ).toBeUndefined();
    expect(sourceLinks(null)).toEqual([]);
  });
});

describe("winery edit form", () => {
  const form = {
    name: " Domaine Test ",
    address: "",
    website: "https://example.com",
    latitude: "48.2",
    longitude: "7.3",
  };
  it("cleans a valid form", () => {
    expect(parseWineryEdit(form)).toEqual({
      name: "Domaine Test",
      address: null,
      website: "https://example.com",
      latitude: 48.2,
      longitude: 7.3,
    });
  });
  it("rejects a missing name, a bad website and a bad position", () => {
    expect(typeof parseWineryEdit({ ...form, name: " " })).toBe("string");
    expect(typeof parseWineryEdit({ ...form, website: "example.com" })).toBe("string");
    expect(typeof parseWineryEdit({ ...form, latitude: "" })).toBe("string");
    expect(typeof parseWineryEdit({ ...form, longitude: "200" })).toBe("string");
  });
});
