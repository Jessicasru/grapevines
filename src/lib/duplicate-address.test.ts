import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const connection = process.env['SUPABASE_DB_URL'];
const sql = connection ? postgres(connection, { max: 1 }) : null;
afterAll(async () => { await sql?.end(); });
describe.skipIf(!sql)('duplicate address rules', () => {
  it('prefers OSM tags over the formatted address', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_address('{"address":"99 Other Road","sources":[{"source":"osm","tags":{"addr:housenumber":"12 A","addr:street":"R. des Vignes"}}]}'::jsonb) as address`;
    expect(r?.['address']).toEqual({ house: '12a', street: 'rue des vignes' });
  });
  it('extracts a leading number without consuming the first street letter', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_address('{"address":"12 Rue des Vignes, 68000 Colmar"}'::jsonb) as address`;
    expect(r?.['address']).toEqual({ house: '12', street: 'rue des vignes' });
  });
  it('normalizes street abbreviations, accents and grand rue punctuation', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_street('R. des Écoles')=public.duplicate_street('route des ecoles') as route, public.duplicate_street('rte des Ecoles')=public.duplicate_street('rue des Ecoles') as rte, public.duplicate_street('Grand''rue')=public.duplicate_street('Grand Rue') as grand`;
    expect(r).toEqual({ route: true, rte: true, grand: true });
  });
  it('matches both endpoints of 12-14 but not a different number', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_house_matches('12-14','12') as first, public.duplicate_house_matches('12-14','14') as last, public.duplicate_house_matches('12-14','16') as other`;
    expect(r).toEqual({ first: true, last: true, other: false });
  });
  it('dismisses different house numbers only when both streets match', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_classification('{"name":"Domaine Muller","address":"12 Rue des Vignes"}', '{"name":"Cave Muller","address":"14 Rte des Vignes"}') as classification`;
    expect(r?.['classification']).toBe('different');
  });
  it('merges matching addresses only with a shared name word of at least three letters', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_classification('{"name":"Domaine Muller","address":"12-14 Grand Rue"}', '{"name":"Cave Muller","address":"14 Grand''rue"}') as shared, public.duplicate_classification('{"name":"Muller","address":"12 Rue des Vignes"}', '{"name":"Mullerr","address":"12 Rue des Vignes"}') as trigram`;
    expect(r).toEqual({ shared: 'same', trigram: 'manual' });
  });
  it('keeps incomplete addresses and different streets manual', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_classification('{"name":"Muller","address":"Rue des Vignes"}', '{"name":"Muller","address":"12 Rue des Vignes"}') as incomplete, public.duplicate_classification('{"name":"Muller","address":"12 Rue des Vignes"}', '{"name":"Muller","address":"12 Rue des Ecoles"}') as other`;
    expect(r).toEqual({ incomplete: 'manual', other: 'manual' });
  });
  it('scores more filled fields higher without counting source bookkeeping', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_filled_count('{"name":"Muller","website":"https://example.org","sources":[]}'::jsonb) as filled, public.duplicate_filled_count('{"name":"Muller","website":"","sources":[{"source":"osm"}]}'::jsonb) as empty`;
    expect(r).toEqual({ filled: 2, empty: 1 });
  });
});