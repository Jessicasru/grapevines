import { describe, expect, it } from "vitest";
import { csvSourceSchema, parseWineryCsv } from "./csv-import";

const header = "source_id,name,latitude,longitude,website,address,postcode,locality,description";
describe("winery CSV input", () => {
  it("allows exactly the two requested sources", () => {
    expect(csvSourceSchema.options).toEqual(["datatourisme", "overture"]);
    expect(csvSourceSchema.safeParse("osm").success).toBe(false);
  });
  it("preserves optional columns and full raw strings including quoted multiline data", () => {
    expect(parseWineryCsv(`${header},extra\n123,Estate,48.2,7.35,,,,,"A note,\nwith a second line",untouched`)).toEqual([
      { source_id: "123", name: "Estate", latitude: "48.2", longitude: "7.35", website: "", address: "", postcode: "", locality: "", description: "A note,\nwith a second line", extra: "untouched" },
    ]);
  });
  it("accepts empty values in all standard columns", () => {
    expect(parseWineryCsv(`${header}\n"",,,,,,,,`)[0]).toEqual(Object.fromEntries(header.split(",").map((key) => [key, ""])));
  });
  it("requires the standard columns without ignoring missing ones", () => {
    expect(() => parseWineryCsv("source_id,name\n123,Estate")).toThrow("Missing CSV columns");
  });
});