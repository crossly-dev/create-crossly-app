import type { PriceDropConfig } from './config.js';
import type { CrosslyApi, ListingRow } from './crossly.js';
import { money, type Notifier } from './notify.js';

export interface PlannedDrop {
  id: string;
  title: string;
  oldPrice: number;
  newPrice: number;
  /** True when the floor stopped the full percentage. */
  atFloor: boolean;
}

export interface SkippedListing {
  id: string;
  reason: string;
}

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Which stale listings to drop, and to what. Pure: no API calls, so it is easy to test.
 *
 * "Stale" is updatedAt older than `staleDays`. A price change updates the listing,
 * so a listing dropped today becomes stale again `staleDays` from now: the cadence
 * falls out of the data instead of needing its own bookkeeping.
 */
export function planPriceDrops(
  listings: ListingRow[],
  config: Pick<PriceDropConfig, 'percent' | 'staleDays' | 'minPrice'>,
  now: Date = new Date(),
): { drops: PlannedDrop[]; skipped: SkippedListing[] } {
  const drops: PlannedDrop[] = [];
  const skipped: SkippedListing[] = [];
  const cutoff = now.getTime() - config.staleDays * DAY_MS;

  for (const l of listings) {
    if (l.status !== 'active') continue;
    const updated = Date.parse(l.updatedAt);
    if (!Number.isFinite(updated) || updated > cutoff) continue;

    const price = l.price === null ? NaN : Number(l.price);
    if (!Number.isFinite(price) || price <= 0) {
      skipped.push({ id: l.id, reason: 'no price' });
      continue;
    }
    if (l.floorIsNet && l.priceFloorCents) {
      // A net floor depends on each marketplace's fees; leave those to Crossly's own repricer.
      skipped.push({ id: l.id, reason: 'net payout floor set' });
      continue;
    }

    const floor = Math.max(config.minPrice, l.priceFloorCents ? l.priceFloorCents / 100 : 0);
    const target = round2(price * (1 - config.percent / 100));
    const newPrice = round2(Math.max(target, floor));
    if (newPrice >= price) {
      skipped.push({ id: l.id, reason: `already at its floor (${money(floor, l.currency ?? 'USD')})` });
      continue;
    }
    drops.push({ id: l.id, title: l.title ?? l.id, oldPrice: price, newPrice, atFloor: newPrice > target });
  }

  // Oldest first: they have waited longest.
  const updatedAt = new Map(listings.map((l) => [l.id, Date.parse(l.updatedAt)]));
  drops.sort((a, b) => (updatedAt.get(a.id) ?? 0) - (updatedAt.get(b.id) ?? 0));
  return { drops, skipped };
}

export interface PriceDropResult {
  applied: PlannedDrop[];
  failed: Array<PlannedDrop & { error: string }>;
  planned: PlannedDrop[];
  skipped: SkippedListing[];
  dryRun: boolean;
}

export async function runPriceDrop(
  api: CrosslyApi,
  config: PriceDropConfig,
  notify: Notifier,
  { now = new Date(), log = console }: { now?: Date; log?: Pick<Console, 'info' | 'warn'> } = {},
): Promise<PriceDropResult> {
  const listings = await api.activeListings();
  const { drops, skipped } = planPriceDrops(listings, config, now);
  const planned = drops.slice(0, config.maxPerRun);
  const result: PriceDropResult = { applied: [], failed: [], planned, skipped, dryRun: config.dryRun };

  const day = now.toISOString().slice(0, 10);
  for (const drop of planned) {
    if (config.dryRun) {
      log.info(`[price-drop] dry run: ${drop.title}: ${money(drop.oldPrice)} -> ${money(drop.newPrice)}`);
      continue;
    }
    try {
      // Same key for the same drop on the same day, so a crash-and-retry cannot drop twice.
      await api.setPrice(drop.id, drop.newPrice, `price-drop:${drop.id}:${drop.oldPrice}:${drop.newPrice}:${day}`);
      result.applied.push(drop);
    } catch (err) {
      result.failed.push({ ...drop, error: err instanceof Error ? err.message : String(err) });
      log.warn(`[price-drop] ${drop.id} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (planned.length) {
    const lines = (config.dryRun ? planned : result.applied).map(
      (d) => `- ${d.title}: ${money(d.oldPrice)} -> ${money(d.newPrice)}${d.atFloor ? ' (floor)' : ''}`,
    );
    const head = config.dryRun
      ? `Price drop (dry run, nothing changed): ${planned.length} stale listing(s) would drop ${config.percent}%`
      : `Price drop: ${result.applied.length} stale listing(s) dropped ${config.percent}%` +
        (result.failed.length ? `, ${result.failed.length} failed` : '');
    await notify([head, ...lines].join('\n'));
  }
  return result;
}
