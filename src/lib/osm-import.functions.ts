import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BBOX = "47.77,7.07,49.08,7.97";
const QUERY = `[out:json][timeout:120];(node["craft"="winery"](${BBOX});way["craft"="winery"](${BBOX});relation["craft"="winery"](${BBOX});node["shop"="winery"](${BBOX});way["shop"="winery"](${BBOX}););out center tags;`;
const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const ROUND_WAITS = [10, 30, 60];

class OverpassError extends Error {
  constructor(message: string, public retryAfter?: number) { super(message); }
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n);
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.max(0, (d - Date.now()) / 1000);
}

async function fetchOverpass(url: string, userAgent: string) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent },
      body: "data=" + encodeURIComponent(QUERY),
      signal: AbortSignal.timeout(130_000),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new OverpassError(timedOut ? "timed out" : `network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new OverpassError(`HTTP ${res.status}`, parseRetryAfter(res.headers.get("retry-after")));
  const json = (await res.json()) as { elements?: unknown[] };
  return json.elements ?? [];
}

async function loadElements(userAgent: string) {
  const errors: Record<string, string> = {};
  for (let round = 0; round <= ROUND_WAITS.length; round++) {
    let retryAfter: number | undefined;
    for (const url of SERVERS) {
      try {
        return { elements: await fetchOverpass(url, userAgent), server: url };
      } catch (e) {
        const err = e instanceof OverpassError ? e : new OverpassError(String(e));
        errors[url] = err.message;
        if (err.retryAfter !== undefined) retryAfter = Math.max(retryAfter ?? 0, err.retryAfter);
        console.error("Overpass failed", round, url, err.message);
      }
    }
    if (round < ROUND_WAITS.length) {
      const wait = retryAfter ?? ROUND_WAITS[round] ?? 0;
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  throw new Error("All Overpass servers failed:\n" + SERVERS.map((u) => `${u}: ${errors[u]}`).join("\n"));
}

export type ImportSummary = { created: number; updated: number; skipped_no_name: number; skipped_outside: number; server: string };

export const importAlsaceFromOsm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (!isAdmin) throw new Error("Not allowed");
    const email = (context.claims as { email?: string }).email ?? "unknown";
    const { elements, server } = await loadElements(`Grapevines winery importer (contact: ${email})`);
    const { data, error } = await context.supabase.rpc("import_osm_wineries", { _elements: elements as never });
    if (error) throw new Error(error.message);
    return { ...(data as unknown as Omit<ImportSummary, "server">), server };
  });
