import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

const connection = process.env['SUPABASE_DB_URL'];
const sql = connection ? postgres(connection, { max: 1 }) : null;
vi.setConfig({ testTimeout: 30000 });
afterAll(async () => { await sql?.end(); });
describe.skipIf(!sql)('duplicate name rules', () => {
  it('removes accents, punctuation and every specified generic word', async () => {
    if (!sql) return;
    const [r] = await sql`select public.normalized_winery_name('DOMAINE Vins Vin Vignoble Vignobles Cave Caves Caveau Maison Alsace d de du des la le les et fils fille filles famille earl scea gaec sarl sas Émile—Müller') as name`;
    expect(r?.['name']).toBe('emile muller');
  });
  it('accepts shared words with at least 3 letters', async () => {
    if (!sql) return;
    const [r] = await sql`select public.winery_names_match('Domaine Max Alpha','Cave Max Zulu') as match`;
    expect(r?.['match']).toBe(true);
  });
  it('does not match solely on a short word or generic words', async () => {
    if (!sql) return;
    const [r] = await sql`select public.winery_names_match('Domaine Jo Alpha','Cave Jo Zulu') as match`;
    expect(r?.['match']).toBe(false);
  });
  it('accepts trigram similarity above 0.5 without a shared word', async () => {
    if (!sql) return;
    const [r] = await sql`select public.winery_names_match('Muller','Mullerr') as match`;
    expect(r?.['match']).toBe(true);
  });
});

// Explicit integration run only; temporary rows marked duplicate-verification
// must be removed with the privileged data tool after the tests.
describe.skipIf(process.env['RUN_DUPLICATE_DATABASE_TESTS'] !== '1')('manual duplicate review', () => {
  const fixtureIds: string[] = [];
  async function api(path: string, body?: unknown, anonymous = false) {
    const session = JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON'] ?? '{}');
    const response = await fetch(`${process.env['SUPABASE_URL']}/rest/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { apikey: process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_ANON_KEY'] ?? '', ...(!anonymous ? { Authorization: `Bearer ${session.access_token}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message ?? String(response.status));
    return data;
  }
  async function fixture(distance: number) {
    if (!sql) throw new Error('Database connection unavailable');
    const [r] = await sql`select id,extensions.ST_Y(extensions.ST_PointOnSurface(boundary)) lat,extensions.ST_X(extensions.ST_PointOnSurface(boundary)) lng from public.regions where name='Alsace'`;
    if (!r) throw new Error('Alsace unavailable');
    const session = JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON'] ?? '{}');
    const tag = crypto.randomUUID().replaceAll('-','');
    const rows = [0,1].map((i) => ({ id: crypto.randomUUID(), region_id: r['id'], name: `Domaine ${tag}`, latitude: Number(r['lat']) + i*distance/111195, longitude: Number(r['lng']), created_by: session.user.id, sources: [{ source: i ? 'overture' : 'datatourisme', source_id: `duplicate-verification-${tag}-${i}` }], website: i ? 'https://example.org' : null, address: i ? 'Other address' : 'Kept address' }));
    fixtureIds.push(...rows.map((w) => w.id));
    await api('wineries',rows);
    return rows;
  }
  async function candidates() { return await api('rpc/winery_duplicate_candidates',{}); }
  it('includes pairs within 150m and excludes those beyond', async () => {
    const near = await fixture(149), far = await fixture(151);
    const pairs = await candidates();
    expect(pairs.some((p: any) => [p.winery_a.id,p.winery_b.id].includes(near[0]?.id) && [p.winery_a.id,p.winery_b.id].includes(near[1]?.id))).toBe(true);
    expect(pairs.some((p: any) => [p.winery_a.id,p.winery_b.id].includes(far[0]?.id) && [p.winery_a.id,p.winery_b.id].includes(far[1]?.id))).toBe(false);
    expect(pairs.map((p: any) => p.distance_metres)).toEqual(pairs.map((p: any) => p.distance_metres).sort((a: number,b: number) => a-b));
  });
  it('remembers dismissal regardless of pair order', async () => {
    const [a,b] = await fixture(50); if (!a || !b) throw new Error('Missing fixture');
    await api('rpc/dismiss_winery_duplicate',{ _a:b.id,_b:a.id });
    expect((await candidates()).some((p: any) => [p.winery_a.id,p.winery_b.id].includes(a.id))).toBe(false);
  });
  it('keeps chosen details, combines sources and preserves conflicting notes and saves', async () => {
    const [a,b] = await fixture(50); if (!a || !b) throw new Error('Missing fixture');
    const session = JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON'] ?? '{}');
    await api('recommendations',[{ winery_id:a.id,user_id:session.user.id,author_name:'Verification',verdict:'go',note:'First note' },{ winery_id:b.id,user_id:session.user.id,author_name:'Verification',verdict:'skip',note:'Second note' }]);
    await api('saves',[{ winery_id:a.id,user_id:session.user.id,status:'want_to_visit' },{ winery_id:b.id,user_id:session.user.id,status:'want_to_visit' },{ winery_id:b.id,user_id:session.user.id,status:'been_here' }]);
    expect(await api('rpc/merge_winery_duplicate',{_keep:a.id,_remove:b.id})).toBe(a.id);
    const [kept] = await api(`wineries?id=eq.${a.id}&select=*`);
    expect(kept.address).toBe('Kept address'); expect(kept.website).toBe('https://example.org'); expect(kept.sources).toHaveLength(2);
    expect(await api(`wineries?id=eq.${b.id}&select=id`)).toEqual([]);
    const recs = await api(`recommendations?winery_id=eq.${a.id}&select=*`);
    expect(recs.map((r: any) => r.note).sort()).toEqual(['First note','Second note']);
    expect((await api(`saves?winery_id=eq.${a.id}&select=*`)).map((s: any) => s.status).sort()).toEqual(['been_here','want_to_visit']);
  });
  it('does not expose candidates to anonymous visitors', async () => {
    await expect(api('rpc/winery_duplicate_candidates',{},true)).rejects.toThrow();
  });
});