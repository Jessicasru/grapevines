import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { boundariesQuery } from "@/lib/wine";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin_/regions")({
  head: () => ({
    meta: [
      { title: "Region boundaries — Cellar Door" },
      { name: "description", content: "Upload region boundaries." },
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Region boundaries — Cellar Door" },
      { property: "og:description", content: "Upload region boundaries." },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegionsAdmin,
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

function RegionsAdmin() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const isAdmin = !!profile?.is_admin;
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().finally(() => setTimeout(() => setChecked(true), 300));
  }, []);

  const regions = useQuery({
    queryKey: ["admin-regions"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("regions").select("id, name, country").order("name");
      if (error) throw error;
      return data;
    },
  });
  const boundaries = useQuery({ ...boundariesQuery, enabled: isAdmin });

  if (!checked || (user && !profile)) return <div className="min-h-dvh bg-background" />;
  if (!isAdmin) return <NotFound />;

  async function upload(regionId: string, file: File) {
    setBusy(regionId);
    try {
      const json = JSON.parse(await file.text());
      if (json?.type !== "FeatureCollection") throw new Error("The file must be a GeoJSON FeatureCollection.");
      const { data, error } = await supabase.rpc("set_region_boundary", { _region_id: regionId, _geojson: json });
      if (error) throw error;
      toast.success(`Boundary saved. ${data} wineries assigned to this region.`);
      qc.invalidateQueries({ queryKey: boundariesQuery.queryKey });
      qc.invalidateQueries({ queryKey: ["wineries"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  const has = new Set((boundaries.data ?? []).map((b) => b.id));

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pt-4">
        <Link to="/admin" aria-label="Back to admin" className="grid size-10 place-items-center rounded-full bg-card text-foreground" style={cardShadow}>
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-bold">Region boundaries</h1>
      </header>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <p className="mt-2 text-sm text-muted-foreground">
          Upload a GeoJSON FeatureCollection. A winery belongs to the nearest boundary within 2 km. Files for Champagne and Bourgogne are in the repository under data/boundaries.
        </p>
        <ul className="mt-4 space-y-3">
          {(regions.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-card p-4" style={cardShadow}>
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}, {r.country}</p>
                <p className="text-sm text-muted-foreground">{has.has(r.id) ? "Boundary uploaded" : "No boundary yet"}</p>
              </div>
              <Button asChild size="sm" variant="outline" className="rounded-full" disabled={busy === r.id}>
                <label className="cursor-pointer">
                  <Upload className="size-4" /> {busy === r.id ? "Uploading…" : has.has(r.id) ? "Replace" : "Upload"}
                  <input type="file" accept=".geojson,.json,application/geo+json,application/json" className="sr-only"
                    disabled={busy !== null}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(r.id, f); }} />
                </label>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
