import { describe, expect, it, vi } from 'vitest';
import { loadConfig, notifyKindFor, type PriceDropConfig } from '../src/config.js';
import { connect, type ListingRow, type SaleRow } from '../src/crossly.js';
import { payloadFor } from '../src/notify.js';
import { planPriceDrops, runPriceDrop } from '../src/price-drop.js';
import { checkNewSales, formatSale } from '../src/sales.js';
import { emptyState } from '../src/state.js';

const PAT = 'crossly_pat_test_00000000_abcdefghijklmnopqrstuvwxyz012345';
const NOW = new Date('2026-11-27T16:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const listing = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: 'lst_1',
  title: "Levi's 501",
  status: 'active',
  price: '50.00',
  currency: 'USD',
  updatedAt: daysAgo(30),
  priceFloorCents: null,
  floorIsNet: false,
  ...over,
});

const sale = (id: string, over: Partial<SaleRow> = {}): SaleRow => ({
  id,
  platform: 'poshmark',
  listingId: 'lst_1',
  platformOrderId: 'po_1',
  salePrice: '84.00',
  platformFee: '16.80',
  netProfit: '47.24',
  currency: 'USD',
  detectedAt: NOW.toISOString(),
  cancelledAt: null,
  deletedAt: null,
  ...over,
});

/** A fake Crossly API behind the REAL @crossly/sdk client, so URLs, headers and bodies are what ships. */
function fakeCrossly(routes: { sales?: SaleRow[]; listings?: ListingRow[] }) {
  const calls: Array<{ method: string; url: URL; headers: Headers; body: unknown }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'GET' && url.pathname === '/api/v1/sales') return json({ data: routes.sales ?? [], pagination: { page: 1, limit: 50 } });
    if (method === 'GET' && url.pathname === '/api/v1/listings') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const all = routes.listings ?? [];
      return json({ data: all.slice((page - 1) * limit, page * limit), pagination: { page, limit } });
    }
    const one = url.pathname.match(/^\/api\/v1\/listings\/([^/]+)$/);
    if (one && method === 'GET') return json({ ...listing({ id: one[1]! }) });
    if (one && method === 'PATCH') return json({ warnings: [], jobs: [] });
    return json({ error: { code: 'not_found', message: 'no route' }, correlationId: 'req-test' }, 404);
  });
  return { api: connect({ pat: PAT, fetch: fetchMock as unknown as typeof fetch }), calls };
}

const dropConfig: PriceDropConfig = { enabled: true, percent: 10, staleDays: 14, minPrice: 5, hourUtc: 15, maxPerRun: 25, dryRun: false };

describe('planPriceDrops', () => {
  it('drops stale active listings by the percentage, rounded to the cent', () => {
    const { drops } = planPriceDrops([listing({ price: '33.33' })], dropConfig, NOW);
    expect(drops).toEqual([{ id: 'lst_1', title: "Levi's 501", oldPrice: 33.33, newPrice: 30, atFloor: false }]);
  });

  it('leaves recently changed and non-active listings alone', () => {
    const { drops } = planPriceDrops(
      [listing({ id: 'fresh', updatedAt: daysAgo(3) }), listing({ id: 'draft', status: 'draft' }), listing({ id: 'ended', status: 'ended' })],
      dropConfig,
      NOW,
    );
    expect(drops).toEqual([]);
  });

  it("never goes below the seller's floor or the configured minimum", () => {
    const { drops, skipped } = planPriceDrops(
      [
        listing({ id: 'floor', price: '20.00', priceFloorCents: 1900 }),
        listing({ id: 'min', price: '5.50' }),
        listing({ id: 'at-floor', price: '19.00', priceFloorCents: 1900 }),
      ],
      dropConfig,
      NOW,
    );
    expect(drops.map((d) => [d.id, d.newPrice, d.atFloor])).toEqual([
      ['floor', 19, true],
      ['min', 5, true],
    ]);
    expect(skipped.map((s) => s.id)).toEqual(['at-floor']);
  });

  it('skips listings with a net payout floor (fees vary per marketplace)', () => {
    const { drops, skipped } = planPriceDrops([listing({ priceFloorCents: 2000, floorIsNet: true })], dropConfig, NOW);
    expect(drops).toEqual([]);
    expect(skipped[0]?.reason).toMatch(/net payout floor/);
  });
});

describe('runPriceDrop against the SDK', () => {
  it('pages through active listings and PATCHes { changes: { price } } with an idempotency key', async () => {
    const many = Array.from({ length: 130 }, (_, i) => listing({ id: `lst_${i}`, updatedAt: daysAgo(20 + i) }));
    const { api, calls } = fakeCrossly({ listings: many });
    const notify = vi.fn(async () => {});
    const result = await runPriceDrop(api, { ...dropConfig, maxPerRun: 3 }, notify, { now: NOW, log: { info() {}, warn() {} } });

    const lists = calls.filter((c) => c.method === 'GET' && c.url.pathname === '/api/v1/listings');
    expect(lists.map((c) => c.url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(lists[0]!.url.searchParams.get('status')).toBe('active');
    expect(lists[0]!.headers.get('authorization')).toBe(`Bearer ${PAT}`);

    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(3);
    // Oldest first.
    expect(patches[0]!.url.pathname).toBe('/api/v1/listings/lst_129');
    expect(patches[0]!.body).toEqual({ changes: { price: 45 } });
    expect(patches[0]!.headers.get('idempotency-key')).toBe('price-drop:lst_129:50:45:2026-11-27');
    expect(result.applied).toHaveLength(3);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('changes nothing in dry-run mode', async () => {
    const { api, calls } = fakeCrossly({ listings: [listing()] });
    const notify = vi.fn(async () => {});
    const result = await runPriceDrop(api, { ...dropConfig, dryRun: true }, notify, { now: NOW, log: { info() {}, warn() {} } });
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(result.planned).toHaveLength(1);
    expect(String((notify.mock.calls[0] as unknown[])[0])).toMatch(/dry run/);
  });
});

describe('checkNewSales against the SDK', () => {
  it('seeds silently on the first run, then notifies only new sales, oldest first', async () => {
    const state = emptyState();
    const notify = vi.fn(async (_text: string) => {});

    const first = fakeCrossly({ sales: [sale('s2'), sale('s1')] });
    expect(await checkNewSales(first.api, state, notify)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(first.calls[0]!.url.pathname).toBe('/api/v1/sales');
    expect(first.calls[0]!.url.searchParams.get('limit')).toBe('50');

    const second = fakeCrossly({ sales: [sale('s4'), sale('s3', { platform: 'ebay' }), sale('s2'), sale('s1')] });
    const fresh = await checkNewSales(second.api, state, notify);
    expect(fresh.map((s) => s.id)).toEqual(['s3', 's4']);
    expect(notify.mock.calls.map((c) => c[0])).toEqual([
      `Sold on ebay: "Levi's 501" for $84.00 (fee $16.80, profit $47.24)`,
      `Sold on poshmark: "Levi's 501" for $84.00 (fee $16.80, profit $47.24)`,
    ]);
    expect(await checkNewSales(second.api, state, notify)).toEqual([]);
  });

  it('ignores cancelled sales', async () => {
    const state = { ...emptyState(), salesInitialized: true };
    const { api } = fakeCrossly({ sales: [sale('s9', { cancelledAt: NOW.toISOString() })] });
    expect(await checkNewSales(api, state, vi.fn(async () => {}))).toEqual([]);
  });
});

describe('notifications and config', () => {
  it('speaks Slack and Discord', () => {
    expect(notifyKindFor('https://hooks.slack.com/services/T/B/X')).toBe('slack');
    expect(notifyKindFor('https://discord.com/api/webhooks/1/abc')).toBe('discord');
    expect(payloadFor('slack', 'hi')).toMatchObject({ text: 'hi' });
    expect(payloadFor('discord', 'hi')).toMatchObject({ content: 'hi' });
    expect((payloadFor('discord', 'x'.repeat(3000)).content as string).length).toBe(2000);
  });

  it('formats a sale without a title', () => {
    expect(formatSale(sale('s1', { netProfit: null }), null)).toBe('Sold on poshmark for $84.00 (fee $16.80)');
  });

  it('defaults to a dry run and refuses a non-PAT token', () => {
    expect(loadConfig({ CROSSLY_PAT: PAT }).priceDrop.dryRun).toBe(true);
    expect(() => loadConfig({})).toThrow(/CROSSLY_PAT/);
    expect(() => loadConfig({ CROSSLY_PAT: 'crossly_pk_live_abc' })).toThrow(/personal access token/);
    expect(() => loadConfig({ CROSSLY_PAT: PAT, PRICE_DROP_PERCENT: '90' })).toThrow(/PRICE_DROP_PERCENT/);
  });
});
