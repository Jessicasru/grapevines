import { describe, expect, it } from "vitest";
import { importAreas, overpassQuery } from "./osm-import";

describe("OpenStreetMap import areas", () => {
  it("fits a box with a margin around the points in each tile", () => {
    const areas = importAreas({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [7.1, 47.8],
            [7.2, 47.8],
            [7.2, 47.9],
            [7.1, 47.8],
          ],
        ],
        [
          [
            [3.6, 46.2],
            [3.7, 46.2],
            [3.7, 46.3],
            [3.6, 46.2],
          ],
        ],
      ],
    });
    expect(areas).toEqual([
      { south: 47.77, west: 7.07, north: 47.93, east: 7.23 },
      { south: 46.17, west: 3.57, north: 46.33, east: 3.73 },
    ]);
  });

  it("splits a long region into tiles instead of one large box", () => {
    const areas = importAreas({
      type: "LineString",
      coordinates: [
        [-1.5, 47.2],
        [0.5, 47.3],
        [2.8, 47.3],
      ],
    });
    expect(areas).toHaveLength(3);
    expect(Math.max(...areas.map((a) => a.east - a.west))).toBeLessThan(0.1);
  });

  it("skips outlines without coordinates", () => {
    expect(importAreas({ type: "GeometryCollection", geometries: [] })).toEqual([]);
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
