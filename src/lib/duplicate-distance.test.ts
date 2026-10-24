import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
const connection = process.env['SUPABASE_DB_URL'];
const sql = connection ? postgres(connection, { max: 1 }) : null;
afterAll(async () => { await sql?.end(); });
describe.skipIf(!sql)('duplicate distance and domain rules', () => {
  it('includes 60 metres but rejects more than 60 without matching websites', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_distance_qualifies(60,null,null) as included, public.duplicate_distance_qualifies(60.01,null,null) as excluded`;
    expect(r).toEqual({ included: true, excluded: false });
  });
  it('includes matching domains up to 300 metres, not beyond', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_distance_qualifies(300,'https://www.example.fr/path','http://example.fr/other') as included, public.duplicate_distance_qualifies(300.01,'https://example.fr','https://example.fr') as excluded`;
    expect(r).toEqual({ included: true, excluded: false });
  });
  it('rejects different domains and missing websites beyond 60 metres', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_distance_qualifies(100,'https://example.fr','https://other.fr') as different, public.duplicate_distance_qualifies(100,'https://example.fr',null) as missing`;
    expect(r).toEqual({ different: false, missing: false });
  });
  it('normalizes protocol, www, case, ports and paths without conflating other subdomains', async () => {
    if (!sql) return;
    const [r] = await sql`select public.duplicate_website_domain('HTTPS://WWW.Example.FR:443/a?q=1') as domain, public.duplicate_distance_qualifies(100,'shop.example.fr','example.fr') as subdomain`;
    expect(r).toEqual({ domain: 'example.fr', subdomain: false });
  });
});