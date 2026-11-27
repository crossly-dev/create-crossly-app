import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CatalogError, fetchCatalog, formatPrice, isPublishableKey } from '../lib/catalog';

const PK = 'crossly_pk_live_0123abcd';
const listing = {
  id: 'lst_1',
  title: "Levi's 501",
  description: null,
  priceCents: 4599,
  imageUrl: null,
  brand: "Levi's",
  size: '32x32',
  condition: 'good',
  available: true,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchCatalog', () => {
  it('calls the embed catalog endpoint with the publishable key header and no cookies', async () => {
    const fetchMock = vi.fn(async () => json(200, { data: [listing] }));
    const got = await fetchCatalog({ pk: PK, limit: 24, q: 'denim', fetch: fetchMock as unknown as typeof fetch });
    expect(got).toEqual([listing]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://crossly.net/api/embed/v1/catalog?limit=24&q=denim');
    expect((init.headers as Record<string, string>)['x-crossly-key']).toBe(PK);
    expect(init.credentials).toBe('omit');
  });

  it('clamps limit to the 1-48 the endpoint allows, and honours apiBase', async () => {
    const fetchMock = vi.fn(async () => json(200, { data: [] }));
    await fetchCatalog({ pk: PK, limit: 500, apiBase: 'http://localhost:3001/api/', fetch: fetchMock as unknown as typeof fetch });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://localhost:3001/api/embed/v1/catalog?limit=48');
  });

  it('turns the Crossly error envelope into a CatalogError', async () => {
    const fetchMock = vi.fn(async () =>
      json(401, { error: { code: 'unauthorized', message: 'A valid Crossly publishable key is required.' }, correlationId: 'req-1' }),
    );
    const err = await fetchCatalog({ pk: PK, fetch: fetchMock as unknown as typeof fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogError);
    expect(err).toMatchObject({ status: 401, code: 'unauthorized', message: 'A valid Crossly publishable key is required.' });
  });
});

describe('helpers', () => {
  it('formats integer cents', () => {
    expect(formatPrice(4599)).toBe('$45.99');
  });

  it('accepts only publishable keys', () => {
    expect(isPublishableKey(PK)).toBe(true);
    expect(isPublishableKey('crossly_pat_live_a3b1c2d4_secret')).toBe(false);
    expect(isPublishableKey(undefined)).toBe(false);
  });

  it('keeps @crossly/embed out of server code: lib/catalog.ts imports only its types', () => {
    const source = readFileSync(new URL('../lib/catalog.ts', import.meta.url), 'utf8');
    const imports = source.match(/^import .*from '@crossly\/embed';$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line.startsWith('import type')).toBe(true);
  });
});
