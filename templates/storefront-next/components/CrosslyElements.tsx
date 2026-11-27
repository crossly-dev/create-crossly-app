'use client';

// Thin React wrappers for the @crossly/embed custom elements.
//
// The package defines its elements at import time with `class … extends
// HTMLElement`, which throws on the server. So it is imported inside useEffect:
// on the client only, after hydration. Until then the browser treats the tags as
// unknown elements and keeps their attributes; they upgrade in place when the
// definitions arrive.
import { useEffect } from 'react';

function useCrosslyElements() {
  useEffect(() => {
    void import('@crossly/embed');
  }, []);
}

export interface BuyButtonProps {
  pk: string;
  listingId: string;
  quantity?: number;
  label?: string;
  /** `_self` (default) keeps the back button working; `_blank` opens checkout in a new tab. */
  target?: '_self' | '_blank';
  apiBase?: string;
}

/** Starts a Crossly-hosted checkout. Card details never touch your site. */
export function BuyButton({ pk, listingId, quantity = 1, label = 'Buy now', target = '_self', apiBase }: BuyButtonProps) {
  useCrosslyElements();
  return (
    <crossly-buy-button pk={pk} listing={listingId} quantity={String(quantity)} label={label} target={target} api={apiBase} />
  );
}

export interface CatalogProps {
  pk: string;
  limit?: number;
  q?: string;
  apiBase?: string;
}

/** The drop-in catalog grid, rendered and fetched entirely by the custom element. */
export function Catalog({ pk, limit = 12, q, apiBase }: CatalogProps) {
  useCrosslyElements();
  return <crossly-catalog pk={pk} limit={String(limit)} q={q} api={apiBase} />;
}
