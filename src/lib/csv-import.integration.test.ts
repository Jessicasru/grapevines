import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env["SUPABASE_DB_URL"];
const sql = url ? postgres(url, { max: 1 }) : null;
afterAll(async () => { await sql?.end(); });

// Requires a managed admin session. Remove rows named CSV verification with
// datatourisme/overture provenance using the privileged data tool after a run.
describe.skipIf(!sql || process.env['RUN_CSV_DATABASE_TESTS'] !== '1')("CSV database import rules", () => {
  async function check(run: (tx: postgres.TransactionSql, row: Record<string, string>) => Promise<void>) {
    if (!sql) throw new Error("Database test connection unavailable");
    const sid = crypto.randomUUID();
    try {
      await sql.begin(async (tx) => {
        await tx`set local search_path = public, extensions`;
        const [admin] = await tx`select id from public.profiles where is_admin limit 1`;
        if (!admin) throw new Error("Admin test account unavailable");
        await tx`select set_config('request.jwt.claim.sub', ${admin['id']}, true)`;
        const [point] = await tx`select ST_Y(ST_PointOnSurface(boundary)) as lat, ST_X(ST_PointOnSurface(boundary)) as lng from public.regions where name='Alsace'`;
        if (!point) throw new Error("Alsace boundary unavailable");
        const row = { source_id: sid, name: "CSV verification", latitude: String(point['lat']), longitude: String(point['lng']), website: "", address: "", postcode: "", locality: "", description: "", extra: "raw retained" };
        await run(tx, row);
        throw new Error("ROLLBACK_CSV_TEST");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ROLLBACK_CSV_TEST") throw error;
    }
  }
  async function importRows(tx: postgres.TransactionSql, rows: Record<string, string>[], source = "datatourisme") {
    const session = JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON'] ?? '{}');
    const response = await fetch(`${process.env['SUPABASE_URL']}/rest/v1/rpc/import_csv_wineries`, {
      method: 'POST', headers: { apikey: process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_ANON_KEY'] ?? '', Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ _source: source, _rows: rows }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? 'Import failed');
    void tx;
    return result;
  }
  async function stored(tx: postgres.TransactionSql, sid: string) {
    return await tx`select * from public.wineries where sources @> ${JSON.stringify([{ source: "datatourisme", source_id: sid }])}::jsonb`;
  }
  it("re-imports the same source identity without duplicates", async () => check(async (tx, row) => {
    expect(await importRows(tx, [row])).toEqual({ created: 1, updated: 0, skipped_outside: 0 });
    expect(await importRows(tx, [row])).toEqual({ created: 0, updated: 1, skipped_outside: 0 });
    expect((await stored(tx, row['source_id'] ?? '')).length).toBe(1);
  }));
  it("assigns new wineries to Alsace with pending review and enrichment", async () => check(async (tx, row) => {
    await importRows(tx, [row]);
    const [winery] = await stored(tx, row['source_id'] ?? '');
    const [region] = await tx`select id from public.regions where name='Alsace'`;
    expect(winery?.['region_id']).toBe(region?.['id']);
    expect(winery?.['review_status']).toBe("pending");
    expect(winery?.['enrichment_status']).toBe("pending");
  }));
  for (const field of ["website", "address", "description"] as const) {
    it(`fills empty ${field} without overwriting a stored value`, async () => check(async (tx, row) => {
      await importRows(tx, [row]);
      await importRows(tx, [{ ...row, [field]: "Original value" }]);
      expect((await stored(tx, row['source_id'] ?? ''))[0]?.[field]).toBe("Original value");
      await importRows(tx, [{ ...row, [field]: "Replacement value" }]);
      expect((await stored(tx, row['source_id'] ?? ''))[0]?.[field]).toBe("Original value");
    }));
  }
  it("stores all raw columns and refreshes a single provenance entry", async () => check(async (tx, row) => {
    await importRows(tx, [row]);
    const updated = { ...row, extra: "updated raw" };
    await importRows(tx, [updated]);
    const sources = (await stored(tx, row['source_id'] ?? ''))[0]?.['sources'];
    expect(sources).toHaveLength(1);
    expect(sources[0].raw).toEqual(updated);
    expect(sources[0].source).toBe("datatourisme");
    expect(sources[0].source_id).toBe(row['source_id']);
    expect(Number.isNaN(Date.parse(sources[0].imported_at))).toBe(false);
  }));
  it("uses both source and source_id as the identity", async () => check(async (tx, row) => {
    await importRows(tx, [row]);
    expect(await importRows(tx, [row], "overture")).toEqual({ created: 1, updated: 0, skipped_outside: 0 });
  }));
  it("includes a point inside 2 km and skips one beyond 2 km", async () => check(async (tx, row) => {
    const points = await tx`with edge as (
      select (ST_DumpPoints(boundary)).geom as p, boundary from public.regions where name='Alsace'
    ), north as (select * from edge order by ST_Y(p) desc limit 1)
    select d, ST_Y(ST_Project(p::geography,d,0)::geometry) as lat,
      ST_X(ST_Project(p::geography,d,0)::geometry) as lng,
      ST_Distance(ST_Project(p::geography,d,0), boundary::geography) as distance
    from north cross join (values (1990),(2010)) as distances(d) order by d`;
    expect(points[0]?.['distance']).toBeLessThan(2000);
    expect(points[1]?.['distance']).toBeGreaterThan(2000);
    expect(await importRows(tx, points.map((p) => ({ ...row, source_id: `${row['source_id']}-${p['d']}`, latitude: String(p['lat']), longitude: String(p['lng']) })))).toEqual({ created: 1, updated: 0, skipped_outside: 1 });
  }));
  it("denies anonymous imports", async () => {
    const response = await fetch(`${process.env['SUPABASE_URL']}/rest/v1/rpc/import_csv_wineries`, {
      method: 'POST', headers: { apikey: process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_ANON_KEY'] ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ _source: 'datatourisme', _rows: [] }),
    });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });
  it("rejects empty source IDs inside the boundary rather than creating duplicates", async () => {
    await expect(check(async (tx, row) => { await importRows(tx, [{ ...row, source_id: "" }]); })).rejects.toThrow("empty source_id");
  });
});