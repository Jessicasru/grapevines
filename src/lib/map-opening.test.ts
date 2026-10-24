import { describe, expect, it } from "vitest";
import { openingMapPadding, regionOpeningCamera } from "@/components/WineMap";
import type { Region } from "./wine";

const region = { id: "alsace", center_lng: 7.35, center_lat: 48.2 } as Region;

describe("opening region view", () => {
  it("fits grey and recommended records, excluding other regions", () => {
    expect(regionOpeningCamera(region, [
      { region_id: "alsace", longitude: 7.3, latitude: 48.1 },
      { region_id: "alsace", longitude: 7.8, latitude: 48.7 },
      { region_id: "other", longitude: 10, latitude: 50 },
    ]).bounds).toEqual([[7.3, 48.1], [7.8, 48.7]]);
  });
  it("caps opening and region-change fits at zoom 11", () => {
    expect(regionOpeningCamera(region, []).maxZoom).toBe(11);
  });
  it("uses the region centre only when no wineries exist", () => {
    expect(regionOpeningCamera(region, []).bounds).toEqual([[7.35, 48.2], [7.35, 48.2]]);
  });
  it("reserves 80px above and 220px below on a 390px phone", () => {
    expect(openingMapPadding(390, 180)).toEqual({ top: 80, bottom: 220, left: 32, right: 64 });
  });
  it("clears a taller desktop carousel", () => {
    expect(openingMapPadding(1280, 210)).toEqual({ top: 96, bottom: 250, left: 64, right: 96 });
  });
});