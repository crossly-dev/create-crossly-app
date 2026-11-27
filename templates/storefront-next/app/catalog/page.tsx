import { Catalog } from '@/components/CrosslyElements';
import { SetupNotice } from '@/components/SetupNotice';
import { isPublishableKey } from '@/lib/catalog';

const pk = process.env.NEXT_PUBLIC_CROSSLY_PK;
const apiBase = process.env.NEXT_PUBLIC_CROSSLY_API_BASE || undefined;

/**
 * The zero-code option: <crossly-catalog> fetches and renders the grid in the
 * browser, inside a shadow root. Style it with CSS custom properties and ::part
 * (see app/globals.css). The home page renders the same data on the server
 * instead, with a buy button per card.
 */
export default function CatalogPage() {
  if (!isPublishableKey(pk)) return <SetupNotice value={pk} />;
  return (
    <>
      <h1>Drop-in catalog</h1>
      <p className="lede">
        One element: <code>&lt;crossly-catalog pk=&quot;…&quot;&gt;</code>. It renders client-side from{' '}
        <code>@crossly/embed</code>.
      </p>
      <Catalog pk={pk} limit={24} apiBase={apiBase} />
    </>
  );
}
