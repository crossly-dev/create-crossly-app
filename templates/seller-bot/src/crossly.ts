// The slice of the Crossly API this bot uses, typed from the public OpenAPI spec
// (https://crossly.net/openapi/seller.json): GET /v1/sales, GET /v1/listings,
// GET /v1/listings/{id}, PATCH /v1/listings/{id}. Money fields on these rows are
// decimal strings in dollars ("84.00").
import { createClient, type CrosslyClient } from '@crossly/sdk';

export interface SaleRow {
  id: string;
  platform: string;
  listingId: string | null;
  platformOrderId: string | null;
  salePrice: string | null;
  platformFee: string | null;
  netProfit: string | null;
  currency: string | null;
  detectedAt: string;
  cancelledAt: string | null;
  deletedAt: string | null;
}

export interface ListingRow {
  id: string;
  title: string | null;
  status: string;
  price: string | null;
  currency: string | null;
  updatedAt: string;
  /** The seller's floor, in cents. */
  priceFloorCents: number | null;
  /** True when the floor is a NET payout floor rather than a list price. */
  floorIsNet: boolean | null;
}

interface Page<T> {
  data: T[];
  pagination?: { page?: number; limit?: number; totalPages?: number };
}

export interface CrosslyApi {
  recentSales(limit: number): Promise<SaleRow[]>;
  activeListings(): Promise<ListingRow[]>;
  listingTitle(id: string): Promise<string | null>;
  setPrice(id: string, price: number, idempotencyKey: string): Promise<void>;
}

export function crosslyApi(client: CrosslyClient): CrosslyApi {
  return {
    async recentSales(limit) {
      // Newest first by detectedAt.
      const page = (await client.sales.list({ limit })) as unknown as Page<SaleRow>;
      return page.data ?? [];
    },

    async activeListings() {
      const limit = 100;
      const rows: ListingRow[] = [];
      for (let page = 1; page <= 200; page += 1) {
        const res = (await client.listings.list({ status: 'active', limit, page })) as unknown as Page<ListingRow>;
        const data = res.data ?? [];
        rows.push(...data);
        const totalPages = res.pagination?.totalPages;
        if (data.length < limit || (totalPages !== undefined && page >= totalPages)) break;
      }
      return rows;
    },

    async listingTitle(id) {
      try {
        const listing = (await client.listings.get(id)) as unknown as { title?: string | null; data?: { title?: string | null } };
        return listing.title ?? listing.data?.title ?? null;
      } catch {
        return null;
      }
    },

    async setPrice(id, price, idempotencyKey) {
      // Omitting `platforms` pushes the edit everywhere the listing is live.
      await client.listings.update(id, { changes: { price } }, { idempotencyKey });
    },
  };
}

export function connect(options: { pat: string; baseUrl?: string; fetch?: typeof fetch }): CrosslyApi {
  return crosslyApi(createClient({ pat: options.pat, baseUrl: options.baseUrl, fetch: options.fetch, userAgent: 'crossly-seller-bot' }));
}
