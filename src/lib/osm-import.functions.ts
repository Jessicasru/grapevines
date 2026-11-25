import { createServerFn } from "@tanstack/react-start";
import type { Geometry } from "geojson";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { addCounts, batches } from "@/lib/import-batches";
import { importAreas, overpassQuery } from "@/lib/osm-import";

const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const ROUND_WAITS = [10, 30, 60];
const USER_AGENT = "Grapevines winery importer (contact: rulandjs@gmail.com)";

class ServerError extends Error {
  constructor(message: string, public retryAfter: number | null) { super(message); }
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : Math.max(0, (d - Date.now()) / 1000);
}

async function fetchOverpass(url: string, query: string) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
      body: "data=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(190_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ServerError(timeout ? "timed out" : `network error: ${e instanceof Error ? e.message : String(e)}`, null);
  }
  if (!res.ok) throw new ServerError(`HTTP ${res.status}`, parseRetryAfter(res.headers.get("retry-after")));
  try {
    const json = (await res.json()) as { elements?: unknown[] };
    return json.elements ?? [];
  } catch {
    throw new ServerError("invalid JSON response", null);
  }
}

async function loadElements(query: string): Promise<{ elements: unknown[]; server: string }> {
  const errors: string[] = [];
  for (let round = 0; round <= ROUND_WAITS.length; round++) {
    let retryAfter: number | null = null;
    for (const url of SERVERS) {
      try {
        return { elements: await fetchOverpass(url, query), server: url };
      } catch (e) {
        const err = e instanceof ServerError ? e : new ServerError(String(e), null);
        console.error("Overpass failed", round, url, err.message);
        errors.push(`Round ${round + 1} · ${new URL(url).host}: ${err.message}`);
        if (err.retryAfter != null) retryAfter = Math.max(retryAfter ?? 0, err.retryAfter);
      }
    }
    if (round < ROUND_WAITS.length) {
      const wait = Math.min(retryAfter ?? ROUND_WAITS[round] ?? 60, 300);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  throw new Error("All Overpass servers failed:\n" + errors.join("\n"));
}

export type ImportSummary = { created: number; updated: number; skipped_no_name: number; skipped_outside: number; server: string };

type Counts = Omit<ImportSummary, "server">;

/** One region at a time: a query for every region at once would cover much of France. */
export const importWineriesFromOsm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ regionId: z.string().uuid() }).parse(input))
  .handler(async ({ data: input, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (!isAdmin) throw new Error("Not allowed");
    const { data: boundaries, error: boundaryError } = await context.supabase.rpc("region_boundaries");
    if (boundaryError) throw new Error(boundaryError.message);
    const outline = ((boundaries ?? []) as unknown as { id: string; geojson: Geometry }[]).find(
      (b) => b.id === input.regionId,
    );
    if (!outline) throw new Error("Upload this region's boundary first.");
    const { elements, server } = await loadElements(overpassQuery(importAreas(outline.geojson)));
    const results: Counts[] = [];
    for (const batch of batches(elements)) {
      const { data, error } = await context.supabase.rpc("import_osm_wineries", {
        _elements: batch as never,
      });
      if (error) throw new Error(error.message);
      results.push(data as unknown as Counts);
    }
    const empty = { created: 0, updated: 0, skipped_no_name: 0, skipped_outside: 0 };
    return { ...addCounts([empty, ...results]), server };
  });
