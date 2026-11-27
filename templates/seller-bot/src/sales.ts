import type { CrosslyApi, SaleRow } from './crossly.js';
import { money, type Notifier } from './notify.js';
import type { BotState } from './state.js';

const SEEN_CAP = 1000;

export function formatSale(sale: SaleRow, title: string | null): string {
  const currency = sale.currency ?? 'USD';
  const parts = [`Sold on ${sale.platform}${title ? `: "${title}"` : ''} for ${money(sale.salePrice, currency)}`];
  const extra: string[] = [];
  if (sale.platformFee !== null) extra.push(`fee ${money(sale.platformFee, currency)}`);
  if (sale.netProfit !== null) extra.push(`profit ${money(sale.netProfit, currency)}`);
  if (extra.length) parts.push(`(${extra.join(', ')})`);
  return parts.join(' ');
}

/**
 * Notify about sales not seen before. The first run only records what is already
 * there, so starting the bot does not replay your whole sales history into the channel.
 * Returns the sales it notified about, oldest first.
 */
export async function checkNewSales(api: CrosslyApi, state: BotState, notify: Notifier): Promise<SaleRow[]> {
  const rows = await api.recentSales(50);
  const seen = new Set(state.seenSaleIds);
  const fresh = rows.filter((s) => !seen.has(s.id) && !s.cancelledAt && !s.deletedAt).reverse();

  if (!state.salesInitialized) {
    state.salesInitialized = true;
    state.seenSaleIds = rows.map((s) => s.id).slice(0, SEEN_CAP);
    return [];
  }

  for (const sale of fresh) {
    const title = sale.listingId ? await api.listingTitle(sale.listingId) : null;
    await notify(formatSale(sale, title));
    seen.add(sale.id);
  }
  // Keep the newest ids; the API returns newest first.
  state.seenSaleIds = [...rows.map((s) => s.id), ...state.seenSaleIds.filter((id) => !rows.some((r) => r.id === id))].slice(0, SEEN_CAP);
  return fresh;
}
