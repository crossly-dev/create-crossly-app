import { BuyButton } from '@/components/CrosslyElements';
import { SetupNotice } from '@/components/SetupNotice';
import { CatalogError, fetchCatalog, formatPrice, isPublishableKey, type EmbedListing } from '@/lib/catalog';

// Re-render at most once a minute; between renders visitors get cached HTML.
export const revalidate = 60;

const pk = process.env.NEXT_PUBLIC_CROSSLY_PK;
const apiBase = process.env.NEXT_PUBLIC_CROSSLY_API_BASE || undefined;

export default async function ShopPage() {
  if (!isPublishableKey(pk)) return <SetupNotice value={pk} />;

  let listings: EmbedListing[] = [];
  let problem: string | null = null;
  try {
    listings = await fetchCatalog({ pk, limit: 24, apiBase });
  } catch (err) {
    problem = err instanceof CatalogError ? `${err.message} (${err.code})` : 'The catalog could not be loaded.';
  }

  return (
    <>
      <h1>Shop</h1>
      {problem ? <p className="notice">{problem}</p> : null}
      {!problem && listings.length === 0 ? <p className="notice">Nothing listed right now. Check back soon.</p> : null}
      <ul className="grid">
        {listings.map((l) => (
          <li key={l.id} className="card">
            {l.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="thumb" src={l.imageUrl} alt={l.title} loading="lazy" />
            ) : (
              <div className="thumb" aria-hidden />
            )}
            <div className="body">
              <h2 className="title">{l.title}</h2>
              <p className="meta">{[l.brand, l.size, l.condition].filter(Boolean).join(' · ')}</p>
              <p className="price">{l.available ? formatPrice(l.priceCents) : 'Sold'}</p>
              {l.available ? <BuyButton pk={pk} listingId={l.id} apiBase={apiBase} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
