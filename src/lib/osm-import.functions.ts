import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BBOX = "47.77,7.07,49.08,7.97";
const QUERY = `[out:json][timeout:120];(node["craft"="winery"](${BBOX});way["craft"="winery"](${BBOX});relation["craft"="winery"](${BBOX});node["shop"="winery"](${BBOX});way["shop"="winery"](${BBOX}););out center tags;`;
const PRIMARY = "https://overpass-api.de/api/interpreter";
const FALLBACK = "https://overpass.kumi.systems/api/interpreter";

async function fetchOverpass(url: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(QUERY),
    signal: AbortSignal.timeout(130_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = (await res.json()) as { elements?: unknown[] };
  return json.elements ?? [];
}

async function loadElements() {
  for (let attempt = 0; attempt <= 3; attempt++) {
    try { return await fetchOverpass(PRIMARY); }
    catch (e) { console.error("Overpass primary failed", attempt, e); }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
  }
  return fetchOverpass(FALLBACK);
}

export type ImportSummary = { created: number; updated: number; skipped_no_name: number; skipped_outside: number };

export const importAlsaceFromOsm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (!isAdmin) throw new Error("Not allowed");
    const elements = await loadElements();
    const { data, error } = await context.supabase.rpc("import_osm_wineries", { _elements: elements as never });
    if (error) throw new Error(error.message);
    return data as unknown as ImportSummary;
  });
