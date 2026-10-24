import abbreviations from "country-json/src/country-by-abbreviation.json";
import coordinates from "country-json/src/country-by-geo-coordinates.json";
import type { Region } from "./wine";

export type MapBounds = [[number, number], [number, number]];
export type MapLocation = { kind: "world" } | { kind: "country"; name: string } | { kind: "region"; id: string };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
export function wineCountries(regions: Region[]) {
  return [...new Set(regions.map((r) => r.country))].sort().map((name) => {
    const record = abbreviations.find((r) => normalize(r.country) === normalize(name) || r.abbreviation === name.toUpperCase());
    const bounds = coordinates.find((r) => r.country === record?.country);
    return { name, iso: record?.abbreviation ?? "", bounds: bounds ? [[bounds.west, bounds.south], [bounds.east, bounds.north]] as MapBounds : null,
      regions: regions.filter((r) => r.country === name) };
  });
}