import Papa from "papaparse";
import { z } from "zod";

export const csvSourceSchema = z.enum(["datatourisme", "overture"]);
export type CsvSource = z.infer<typeof csvSourceSchema>;
export type CsvRow = Record<string, string>;
export type CsvImportSummary = { created: number; updated: number; skipped_outside: number };
const requiredColumns = ["source_id", "name", "latitude", "longitude", "website", "address", "postcode", "locality", "description"];

export function parseWineryCsv(csv: string): CsvRow[] {
  const parsed = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`CSV could not be read: ${parsed.errors[0]?.message ?? "Invalid file"}`);
  const missing = requiredColumns.filter((column) => !parsed.meta.fields?.includes(column));
  if (missing.length) throw new Error(`Missing CSV columns: ${missing.join(", ")}`);
  if (!parsed.data.length) throw new Error("The CSV has no rows.");
  return parsed.data;
}