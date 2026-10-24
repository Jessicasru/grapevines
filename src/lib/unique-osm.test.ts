import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { manualSourceBreakdown } from './duplicate-sources';
const connection = process.env['SUPABASE_DB_URL'];
const sql = connection ? postgres(connection, { max: 1 }) : null;
afterAll(async () => { await sql?.end(); });
const osm = { id: 'osm', name: 'Domaine Émile Muller', sources: [{ source: 'osm' }] };
const dt = { id: 'dt', name: 'Cave Emile Müller', sources: [{ source: 'datatourisme' }] };
const pair = { winery_a: osm, winery_b: dt, distance_metres: 100 };
async function matches(candidate: unknown, pairs: unknown[]) {
  if (!sql) throw new Error('Missing database connection');
  const [r] = await sql`select public.duplicate_unique_osm(${JSON.stringify(candidate)}::jsonb,${JSON.stringify(pairs)}::jsonb) as match`;
  return r?.['match'];
}
describe.skipIf(!sql)('unique OSM match rules', () => {
  it('accepts a mutually unique pair at 100 metres in either order', async () => {
    expect(await matches(pair,[pair])).toBe(true);
    const reversed = { ...pair, winery_a: dt, winery_b: osm };
    expect(await matches(reversed,[reversed])).toBe(true);
  });
  it('rejects a pair beyond 100 metres', async () => {
    const far = { ...pair, distance_metres: 100.01 };
    expect(await matches(far,[far])).toBe(false);
  });
  it('requires every source on the OSM record to be osm', async () => {
    const mixed = { ...pair, winery_a: { ...osm, sources: [{ source: 'osm' },{ source: 'overture' }] } };
    expect(await matches(mixed,[mixed])).toBe(false);
  });
  it('allows DATAtourisme to have other sources', async () => {
    const mixed = { ...pair, winery_b: { ...dt, sources: [{ source: 'datatourisme' },{ source: 'overture' }] } };
    expect(await matches(mixed,[mixed])).toBe(true);
  });
  it('requires a shared normalized word of at least three letters, not trigram alone', async () => {
    const noWord = { ...pair, winery_a: { ...osm, name: 'Muller' }, winery_b: { ...dt, name: 'Mullerr' } };
    expect(await matches(noWord,[noWord])).toBe(false);
    const short = { ...pair, winery_a: { ...osm, name: 'Domaine Jo Alpha' }, winery_b: { ...dt, name: 'Cave Jo Zulu' } };
    expect(await matches(short,[short])).toBe(false);
  });
  it('rejects another DATAtourisme candidate even beyond the 100 metre rule limit', async () => {
    const other = { ...pair, winery_b: { ...dt, id: 'other-dt' }, distance_metres: 140 };
    expect(await matches(pair,[pair,other])).toBe(false);
  });
  it('rejects another OSM candidate even if that other record has mixed sources', async () => {
    const other = { ...pair, winery_a: { ...osm, id: 'other-osm', sources: [{ source: 'osm' },{ source: 'overture' }] } };
    expect(await matches(pair,[pair,other])).toBe(false);
  });
});
describe('remaining manual source counts', () => {
  it('counts cross-source and same-source pairs once', () => {
    expect(manualSourceBreakdown([{ winery_a: osm, winery_b: dt },{ winery_a: dt, winery_b: dt },{ winery_a: osm, winery_b: osm }])).toEqual({ osmDatatourisme: 1, datatourismeDatatourisme: 1, osmOsm: 1 });
  });
});