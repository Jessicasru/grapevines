import type { Geometry } from "geojson";

export type ImportArea = { south: number; west: number; north: number; east: number };

/**
 * Boxes to search OpenStreetMap in: the outline split into half-degree tiles, each box
 * fitted to the outline's points in that tile and widened by about 3 km. A region such as
 * the Loire spans hundreds of kilometres, so one box around it would cover a third of France.
 */
export function importAreas(geojson: Geometry, tile = 0.5, margin = 0.03): ImportArea[] {
  const tiles = new Map<string, { lngs: number[]; lats: number[] }>();
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      const key = `${Math.floor(value[0] / tile)},${Math.floor(value[1] / tile)}`;
      const points = tiles.get(key) ?? { lngs: [], lats: [] };
      points.lngs.push(value[0]);
      points.lats.push(value[1]);
      tiles.set(key, points);
    } else value.forEach(walk);
  };
  walk("coordinates" in geojson ? geojson.coordinates : []);
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return [...tiles.values()].map(({ lngs, lats }) => ({
    south: round(Math.min(...lats) - margin),
    west: round(Math.min(...lngs) - margin),
    north: round(Math.max(...lats) + margin),
    east: round(Math.max(...lngs) + margin),
  }));
}

/** Every winery tagged in OpenStreetMap within the areas. The database keeps those near an outline. */
export function overpassQuery(areas: ImportArea[]) {
  const parts = areas.flatMap(({ south, west, north, east }) => {
    const box = `(${south},${west},${north},${east})`;
    return [
      `node["craft"="winery"]${box};`,
      `way["craft"="winery"]${box};`,
      `relation["craft"="winery"]${box};`,
      `node["shop"="winery"]${box};`,
      `way["shop"="winery"]${box};`,
    ];
  });
  return `[out:json][timeout:180];(${parts.join("")});out center tags;`;
}
