import { CrosslyAPIError } from '@crossly/sdk';
import { ConfigError, loadConfig, type Config } from './config.js';
import { connect, type CrosslyApi } from './crossly.js';
import { createNotifier, type Notifier } from './notify.js';
import { runPriceDrop } from './price-drop.js';
import { checkNewSales } from './sales.js';
import { loadState, saveState } from './state.js';

// Node 20.12+ reads .env without a dependency.
try {
  process.loadEnvFile();
} catch {
  /* no .env: use the real environment */
}

function describe(err: unknown): string {
  if (err instanceof CrosslyAPIError) return `${err.status} ${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

async function salesTick(config: Config, api: CrosslyApi, notify: Notifier) {
  const state = loadState(config.statePath);
  const fresh = await checkNewSales(api, state, notify);
  saveState(config.statePath, state);
  if (fresh.length) console.info(`[sales] notified ${fresh.length} new sale(s)`);
}

async function priceDropTick(config: Config, api: CrosslyApi, notify: Notifier, force = false) {
  if (!config.priceDrop.enabled) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const state = loadState(config.statePath);
  if (!force && (state.lastPriceDrop === today || now.getUTCHours() < config.priceDrop.hourUtc)) return;
  const result = await runPriceDrop(api, config.priceDrop, notify, { now });
  state.lastPriceDrop = today;
  saveState(config.statePath, state);
  console.info(
    `[price-drop] ${result.dryRun ? 'planned' : 'applied'} ${result.dryRun ? result.planned.length : result.applied.length}, ` +
      `failed ${result.failed.length}, skipped ${result.skipped.length}`,
  );
}

async function main(argv: string[]) {
  const config = loadConfig();
  const api = connect({ pat: config.pat, baseUrl: config.baseUrl });
  const notify = createNotifier(config.notifyUrl, config.notifyKind);

  // One-shot modes, for cron / GitHub Actions / a scheduled container.
  if (argv.includes('--sales')) return salesTick(config, api, notify);
  if (argv.includes('--price-drop')) return priceDropTick(config, api, notify, true);

  console.info(
    `crossly seller bot: sales every ${config.salesIntervalMinutes} min -> ${config.notifyUrl ? config.notifyKind : 'console'}; ` +
      (config.priceDrop.enabled
        ? `price drop ${config.priceDrop.percent}% on listings unchanged for ${config.priceDrop.staleDays} days, daily from ` +
          `${config.priceDrop.hourUtc}:00 UTC${config.priceDrop.dryRun ? ' (DRY RUN: set PRICE_DROP_DRY_RUN=false to apply)' : ''}`
        : 'price drop off'),
  );

  let running = false;
  const tick = async () => {
    if (running) return; // never overlap a slow run with the next tick
    running = true;
    try {
      await salesTick(config, api, notify);
      await priceDropTick(config, api, notify);
    } catch (err) {
      console.error(`[bot] ${describe(err)}`);
    } finally {
      running = false;
    }
  };
  await tick();
  const timer = setInterval(tick, config.salesIntervalMinutes * 60_000);
  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : `[bot] ${describe(err)}`);
  process.exit(1);
});
