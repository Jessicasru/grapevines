import { expect, it } from "vitest";
import { regionMarkerFeatures } from "@/components/WineMap";
import type { Region } from "./wine";

it("handles missing regions without crashing, then accepts loaded regions", () => {
  expect(regionMarkerFeatures(undefined)).toEqual([]);
  expect(regionMarkerFeatures(null)).toEqual([]);
  const region = { id: "alsace", name: "Alsace", center_lng: 7.35, center_lat: 48.2 } as Region;
  expect(regionMarkerFeatures([region])).toEqual([{ type: "Feature", geometry: { type: "Point", coordinates: [7.35, 48.2] }, properties: { id: "alsace", name: "Alsace" } }]);
});