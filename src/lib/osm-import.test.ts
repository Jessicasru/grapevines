import { describe, expect, it } from "vitest";
import { importAreas, overpassQuery } from "./osm-import";

describe("OpenStreetMap import areas", () => {
  it("covers each outline's box plus a margin", () => {
    const areas = importAreas([
      {
        geojson: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [7.1, 47.8],
                [7.9, 47.8],
                [7.9, 49.0],
                [7.1, 47.8],
              ],
            ],
          ],
        },
      },
      {
        geojson: {
          type: "Polygon",
          coordinates: [
            [
              [3.3, 46.2],
              [5.0, 46.2],
              [5.0, 48.0],
              [3.3, 46.2],
            ],
          ],
        },
      },
    ]);
    expect(areas).toEqual([
      { south: 47.77, west: 7.07, north: 49.03, east: 7.93 },
      { south: 46.17, west: 3.27, north: 48.03, east: 5.03 },
    ]);
  });

  it("skips outlines without coordinates", () => {
    expect(importAreas([{ geojson: { type: "GeometryCollection", geometries: [] } }])).toEqual([]);
  });

  it("asks for wineries in every area at once", () => {
    const query = overpassQuery([
      { south: 1, west: 2, north: 3, east: 4 },
      { south: 5, west: 6, north: 7, east: 8 },
    ]);
    expect(query).toContain('node["craft"="winery"](1,2,3,4);');
    expect(query).toContain('way["shop"="winery"](5,6,7,8);');
    expect(query.match(/winery/g)).toHaveLength(10);
  });
});
