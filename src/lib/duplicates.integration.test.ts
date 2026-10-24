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
      method: body === undefined ? 'GET' : 'POST', headers: { apikey: process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_ANON_KEY'] ?? '', ...(!anonymous ? { Authorization: `Bearer ${session.access_token}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message ?? String(response.status));
    return data;
  }
  async function fixture(distance: number, uniqueOsm = false) {
    if (!sql) throw new Error('Database connection unavailable');
    const [r] = await sql`select id,extensions.ST_Y(extensions.ST_PointOnSurface(boundary)) lat,extensions.ST_X(extensions.ST_PointOnSurface(boundary)) lng from public.regions where name='Alsace'`;
    if (!r) throw new Error('Alsace unavailable');
    const session = JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON'] ?? '{}');
    const tag = crypto.randomUUID().replaceAll('-','');
    const rows = [0,1].map((i) => ({ id: crypto.randomUUID(), region_id: r['id'], name: `Domaine ${tag}`, latitude: Number(r['lat']) + i*distance/111195, longitude: Number(r['lng']), created_by: session.user.id, sources: [{ source: i ? (uniqueOsm ? 'osm' : 'overture') : 'datatourisme', source_id: `duplicate-verification-${tag}-${i}` }], website: i ? 'https://example.org' : null, address: i ? 'Other address' : 'Kept address', opening_hours: uniqueOsm && i ? 'Mo-Fr 10:00-18:00' : null, phone: uniqueOsm && i ? '+33000000000' : null }));
    fixtureIds.push(...rows.map((w) => w.id));
    await api('wineries',rows);
    return rows;
  }
  async function candidates() { return await api('rpc/winery_duplicate_candidates',{}); }
  it('includes pairs within 60m and excludes those beyond', async () => {
    const near = await fixture(59), far = await fixture(61);
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
    const history = await api('rpc/duplicate_review_history', {});
    const entry = history.merged.find((h: any) => h.kept_id === a.id && h.removed_id === b.id);
    expect(entry).toBeDefined();
    await api('rpc/undo_winery_merge', { _id: entry.id });
    const [originalA] = await api(`wineries?id=eq.${a.id}&select=*`);
    const [originalB] = await api(`wineries?id=eq.${b.id}&select=*`);
    expect(originalA.website).toBeNull();
    expect(originalB.website).toBe('https://example.org');
    expect(originalB.merged_into).toBeNull();
    expect((await api(`recommendations?winery_id=eq.${b.id}&select=*`)).map((r: any) => r.note)).toEqual(['Second note']);
    expect((await api(`saves?winery_id=eq.${b.id}&select=*`)).map((s: any) => s.status).sort()).toEqual(['been_here','want_to_visit']);
  });
  it('does not expose candidates to anonymous visitors', async () => {
    await expect(api('rpc/winery_duplicate_candidates',{},true)).rejects.toThrow();
  });
  it('previews without changing wineries and refuses Apply after the candidates change', async () => {
    const preview = await api('rpc/preview_winery_duplicates', {});
    expect(preview.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(preview.pairs.every((p: any) => ['same','different','unique_osm','manual'].includes(p.classification))).toBe(true);
    const near = await fixture(50);
    await expect(api('rpc/apply_winery_duplicates', { _preview: preview.id })).rejects.toThrow('The list changed');
    expect((await api(`wineries?id=in.(${near.map(w => w.id).join(',')})&select=merged_into`)).map((w: any) => w.merged_into)).toEqual([null,null]);
  });
  it('keeps preview, Apply and history private to admins', async () => {
    await expect(api('rpc/preview_winery_duplicates',{},true)).rejects.toThrow();
    await expect(api('rpc/duplicate_review_history',{},true)).rejects.toThrow();
    await expect(api('rpc/apply_winery_duplicates',{ _preview:crypto.randomUUID() },true)).rejects.toThrow();
  });
  it('keeps DATAtourisme with OSM coordinates and empty-field fills, then Undo restores both and their linked data', async () => {
    const [dt,osm] = await fixture(50,true);
    if (!dt || !osm) throw new Error('Missing fixture');
    const preview = await api('rpc/preview_winery_duplicates', {});
    const pair = preview.pairs.find((p: any) => [p.winery_a.id,p.winery_b.id].includes(dt.id) && [p.winery_a.id,p.winery_b.id].includes(osm.id));
    expect(pair?.classification).toBe('unique_osm');
    const [before] = await api(`wineries?id=eq.${dt.id}&select=*`);
    expect(before.latitude).toBe(dt.latitude);
    const session = JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON'] ?? '{}');
    await api('recommendations', { winery_id:osm.id,user_id:session.user.id,author_name:'Verification',verdict:'go',note:'OSM note' });
    await api('saves', { winery_id:osm.id,user_id:session.user.id,status:'want_to_visit' });
    expect(await api('rpc/merge_unique_osm_duplicate', { _a:osm.id,_b:dt.id })).toBe(dt.id);
    const [kept] = await api(`wineries?id=eq.${dt.id}&select=*`);
    expect(kept.latitude).toBeCloseTo(osm.latitude, 12);
    expect(kept.longitude).toBeCloseTo(osm.longitude, 12);
    expect(kept.website).toBe('https://example.org');
    expect(kept.phone).toBe('+33000000000');
    expect(kept.opening_hours).toBe('Mo-Fr 10:00-18:00');
    expect(kept.sources).toHaveLength(2);
    expect(await api(`wineries?id=eq.${osm.id}&select=*`)).toEqual([]);
    expect((await api(`recommendations?winery_id=eq.${dt.id}&select=note`)).map((r: any) => r.note)).toEqual(['OSM note']);
    expect(await api(`saves?winery_id=eq.${dt.id}&select=status`)).toHaveLength(1);
    const history = await api('rpc/duplicate_review_history', {});
    const entry = history.merged.find((h: any) => h.kept_id===dt.id && h.removed_id===osm.id);
    expect(entry.mode).toBe('unique_osm');
    await api('rpc/undo_winery_merge', { _id:entry.id });
    const [restored] = await api(`wineries?id=eq.${dt.id}&select=*`);
    expect(restored.latitude).toBe(dt.latitude);
    expect(restored.longitude).toBe(dt.longitude);
    expect(restored.website).toBeNull();
    expect(restored.phone).toBeNull();
    expect(restored.opening_hours).toBeNull();
    expect((await api(`wineries?id=eq.${osm.id}&select=merged_into`))[0].merged_into).toBeNull();
    expect((await api(`recommendations?winery_id=eq.${osm.id}&select=note`)).map((r: any) => r.note)).toEqual(['OSM note']);
    expect(await api(`saves?winery_id=eq.${osm.id}&select=status`)).toHaveLength(1);
  });
});