import type { Geometry } from "geojson";

export type ImportArea = { south: number; west: number; north: number; east: number };

/** Each region outline's bounding box, widened by about 3 km, for the OpenStreetMap search. */
export function importAreas(boundaries: { geojson: Geometry }[], margin = 0.03): ImportArea[] {
  return boundaries.flatMap(({ geojson }) => {
    const lngs: number[] = [];
    const lats: number[] = [];
    const walk = (value: unknown) => {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === "number" && typeof value[1] === "number") {
        lngs.push(value[0]);
        lats.push(value[1]);
      } else value.forEach(walk);
    };
    walk("coordinates" in geojson ? geojson.coordinates : []);
    if (!lngs.length) return [];
    const round = (n: number) => Math.round(n * 10_000) / 10_000;
    return [
      {
        south: round(Math.min(...lats) - margin),
        west: round(Math.min(...lngs) - margin),
        north: round(Math.max(...lats) + margin),
        east: round(Math.max(...lngs) + margin),
      },
    ];
  });
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
