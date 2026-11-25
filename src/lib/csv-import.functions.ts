import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { csvSourceSchema, parseWineryCsv, type CsvImportSummary } from "@/lib/csv-import";

export const importWineriesFromCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ source: csvSourceSchema, csv: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: admin, error: adminError } = await context.supabase.rpc("is_admin");
    if (adminError || !admin) throw new Error("Not allowed");
    const rows = parseWineryCsv(data.csv);
    const { data: summary, error } = await context.supabase.rpc("import_csv_wineries", { _source: data.source, _rows: rows });
    if (error) throw new Error(error.message);
    return summary as unknown as CsvImportSummary;
  });