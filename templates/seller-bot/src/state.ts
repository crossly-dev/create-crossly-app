import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** What the bot remembers between runs. A small JSON file; delete it to start fresh. */
export interface BotState {
  salesInitialized: boolean;
  /** Newest first. */
  seenSaleIds: string[];
  /** YYYY-MM-DD (UTC) of the last price-drop run. */
  lastPriceDrop: string | null;
}

export const emptyState = (): BotState => ({ salesInitialized: false, seenSaleIds: [], lastPriceDrop: null });

export function loadState(path: string): BotState {
  try {
    return { ...emptyState(), ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<BotState>) };
  } catch {
    return emptyState();
  }
}

export function saveState(path: string, state: BotState): void {
  // Write then rename, so a crash mid-write cannot leave a truncated file.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path);
}
