import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { csvSourceSchema, parseWineryCsv, type CsvSource, type CsvImportSummary } from "@/lib/csv-import";
import { importAlsaceFromCsv } from "@/lib/csv-import.functions";

export function CsvImporter() {
  const [source, setSource] = useState<CsvSource>("datatourisme");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [summary, setSummary] = useState<CsvImportSummary | null>(null);
  const importCsv = useServerFn(importAlsaceFromCsv);
  const qc = useQueryClient();

  async function run() {
    if (!file || busy) return;
    setBusy(true);
    setFailure(null);
    setSummary(null);
    try {
      const csv = await file.text();
      parseWineryCsv(csv);
      const result = await importCsv({ data: { source, csv } });
      setSummary(result);
      await qc.invalidateQueries({ queryKey: ["wineries"] });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "CSV import failed.");
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, number][] = summary ? [["Created", summary.created], ["Updated", summary.updated], ["Skipped (outside Alsace)", summary.skipped_outside]] : [];
  return (
    <section className="mt-10 border-t border-border pt-6" aria-labelledby="csv-import-heading">
      <h2 id="csv-import-heading" className="text-xl font-bold">CSV import</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-[180px_1fr]">
        <div className="space-y-2">
          <Label htmlFor="csv-source">Source</Label>
          <Select value={source} onValueChange={(value) => { setSource(csvSourceSchema.parse(value)); setSummary(null); }} disabled={busy}>
            <SelectTrigger id="csv-source" className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="datatourisme">DATAtourisme</SelectItem><SelectItem value="overture">Overture</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="csv-file">CSV file</Label>
          <Input id="csv-file" type="file" accept=".csv,text/csv" disabled={busy} className="h-11 py-2" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setFailure(null); setSummary(null); }} />
        </div>
      </div>
      <Button onClick={run} disabled={busy || !file} className="mt-4 h-11 rounded-full px-5 font-semibold"><Upload className="size-4" />{busy ? "Importing CSV…" : "Import CSV"}</Button>
      {failure && <p role="alert" className="mt-5 whitespace-pre-wrap text-sm text-destructive">{failure}</p>}
      {summary && <dl aria-label="CSV import results" aria-live="polite" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">{rows.map(([label, count]) => <div key={label} className="rounded-lg bg-card p-4 shadow-[var(--shadow-soft)]"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-bold">{count}</dd></div>)}</dl>}
    </section>
  );
}