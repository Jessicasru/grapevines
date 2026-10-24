import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { importAlsaceFromOsm, type ImportSummary } from "@/lib/osm-import.functions";
import { Button } from "@/components/ui/button";
import { CsvImporter } from "@/components/CsvImporter";

export const Route = createFileRoute("/admin_/import")({
  head: () => ({
    meta: [
      { title: "Winery imports — Grapevines" },
      { name: "description", content: "Import Alsace wineries from OpenStreetMap, DATAtourisme or Overture CSV files." },
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Winery imports — Grapevines" },
      { property: "og:description", content: "Import Alsace wineries from OpenStreetMap, DATAtourisme or Overture CSV files." },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportAdmin,
});

const cardShadow = { boxShadow: "var(--shadow-soft)" } as const;

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">The page you're looking for doesn't exist or has been moved.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go home</Link>
        </div>
      </div>
    </div>
  );
}

function ImportAdmin() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().finally(() => setTimeout(() => setChecked(true), 300));
  }, []);

  if (!checked || (user && !profile)) return <div className="min-h-dvh bg-background" />;
  if (!profile?.is_admin) return <NotFound />;

  async function run() {
    setBusy(true);
    setSummary(null);
    setFailure(null);
    try {
      const s = await importAlsaceFromOsm();
      setSummary(s);
      qc.invalidateQueries({ queryKey: ["wineries"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed.";
      setFailure(msg);
      toast.error("Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, number][] = summary
    ? [["Created", summary.created], ["Updated", summary.updated], ["Skipped (no name)", summary.skipped_no_name], ["Skipped (outside Alsace)", summary.skipped_outside]]
    : [];

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pt-4">
        <Link to="/admin" aria-label="Back to admin" className="grid size-10 place-items-center rounded-full bg-card text-foreground" style={cardShadow}>
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-bold">OpenStreetMap import</h1>
      </header>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <p className="mt-2 text-sm text-muted-foreground">
          Fetches every winery tagged in OpenStreetMap around Alsace. Re-running updates existing entries instead of duplicating them. This can take a couple of minutes.
        </p>
        <Button onClick={run} disabled={busy} className="mt-4 h-11 rounded-full px-5 font-semibold">
          <Download className="size-4" /> {busy ? "Importing…" : "Import Alsace from OpenStreetMap"}
        </Button>
        {failure && (
          <pre className="mt-6 whitespace-pre-wrap rounded-lg bg-card p-4 font-sans text-sm text-foreground" style={cardShadow}>{failure}</pre>
        )}
        {summary && (
          <p className="mt-6 text-sm text-muted-foreground">Answered by <span className="font-medium text-foreground">{summary.server}</span></p>
        )}
        {summary && (
          <dl className="mt-6 grid grid-cols-2 gap-3">
            {rows.map(([label, n]) => (
              <div key={label} className="rounded-lg bg-card p-4" style={cardShadow}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-2xl font-bold">{n}</dd>
              </div>
            ))}
          </dl>
        )}
        <CsvImporter />
      </div>
    </div>
  );
}
