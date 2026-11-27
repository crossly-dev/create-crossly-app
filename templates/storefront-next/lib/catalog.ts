// Server-side reads of your Crossly catalog, so product cards render as HTML
// (fast first paint, indexable) instead of waiting for client JavaScript.
//
// This uses the same public endpoint and publishable key as the
// <crossly-catalog> element from @crossly/embed. It imports only TYPES from
// that package: its runtime defines custom elements (`extends HTMLElement`),
// which do not exist on the server.
import type { EmbedListing } from '@crossly/embed';

export type { EmbedListing };

export const DEFAULT_API_BASE = 'https://crossly.net/api';

/** `crossly_pk_<live|test>_<key>`: the only kind of key that belongs in a web page. */
export function isPublishableKey(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^crossly_pk_(live|test)_[A-Za-z0-9]+$/.test(value);
}

export class CatalogError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

export interface FetchCatalogOptions {
  pk: string;
  /** 1-48. Default 12. */
  limit?: number;
  /** Free-text filter over title and brand. */
  q?: string;
  apiBase?: string;
  fetch?: typeof fetch;
  /** Seconds Next.js may cache the response for. Default 60. */
  revalidate?: number;
}

/** Your active listings, as the embed sees them. Money is integer cents. */
export async function fetchCatalog(options: FetchCatalogOptions): Promise<EmbedListing[]> {
  const { pk, limit = 12, q, apiBase = DEFAULT_API_BASE, revalidate = 60 } = options;
  const doFetch = options.fetch ?? fetch;
  const params = new URLSearchParams({ limit: String(Math.min(48, Math.max(1, Math.trunc(limit)))) });
  if (q) params.set('q', q);

  const res = await doFetch(`${apiBase.replace(/\/$/, '')}/embed/v1/catalog?${params}`, {
    headers: { 'x-crossly-key': pk, accept: 'application/json' },
    // No cookies: a publishable key is the whole credential.
    credentials: 'omit',
    next: { revalidate },
  } as RequestInit);

  const body = (await res.json().catch(() => null)) as
    | { data?: EmbedListing[]; error?: { code?: string; message?: string } }
    | null;
  if (!res.ok) {
    throw new CatalogError(
      res.status,
      body?.error?.code ?? `http_${res.status}`,
      body?.error?.message ?? `Crossly catalog request failed (${res.status})`,
    );
  }
  return Array.isArray(body?.data) ? body.data : [];
}

/** Cents to a display string. The API never sends float dollars. */
export function formatPrice(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
