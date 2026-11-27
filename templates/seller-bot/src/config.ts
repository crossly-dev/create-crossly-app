export type NotifyKind = 'slack' | 'discord' | 'generic';

export interface PriceDropConfig {
  enabled: boolean;
  /** Percent off per drop, e.g. 10. */
  percent: number;
  /** A listing is stale when it has not changed for this many days. */
  staleDays: number;
  /** Never price below this many dollars, whatever the percent says. */
  minPrice: number;
  /** Hour of day (UTC) the daily drop runs. */
  hourUtc: number;
  /** Most listings to reprice in one run. */
  maxPerRun: number;
  /** Plan and report only; change nothing. On until you set PRICE_DROP_DRY_RUN=false. */
  dryRun: boolean;
}

export interface Config {
  pat: string;
  baseUrl: string | undefined;
  notifyUrl: string | undefined;
  notifyKind: NotifyKind;
  salesIntervalMinutes: number;
  statePath: string;
  priceDrop: PriceDropConfig;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number, { min, max }: { min: number; max: number }): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new ConfigError(`${key} must be a number from ${min} to ${max} (got "${raw}").`);
  return n;
}

function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${key} must be true or false (got "${env[key]}").`);
}

/** Slack and Discord incoming webhooks take different JSON; tell them apart by host. */
export function notifyKindFor(url: string | undefined): NotifyKind {
  if (!url) return 'generic';
  const host = new URL(url).hostname;
  if (host === 'hooks.slack.com') return 'slack';
  if (/(^|\.)discord(app)?\.com$/.test(host)) return 'discord';
  return 'generic';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const pat = env.CROSSLY_PAT?.trim();
  if (!pat) {
    throw new ConfigError(
      'CROSSLY_PAT is not set. Mint a personal access token in Crossly under Settings → API & webhooks with the ' +
        'scopes sales:read and listings:read (plus listings:write for the price drop), and put it in .env.',
    );
  }
  if (!pat.startsWith('crossly_pat_')) throw new ConfigError('CROSSLY_PAT must be a personal access token (crossly_pat_…).');

  const notifyUrl = env.NOTIFY_WEBHOOK_URL?.trim() || undefined;
  if (notifyUrl && !/^https:\/\//.test(notifyUrl)) throw new ConfigError('NOTIFY_WEBHOOK_URL must be an https:// URL.');

  return {
    pat,
    baseUrl: env.CROSSLY_API_BASE?.trim() || undefined,
    notifyUrl,
    notifyKind: notifyKindFor(notifyUrl),
    salesIntervalMinutes: num(env, 'SALES_INTERVAL_MINUTES', 5, { min: 1, max: 1440 }),
    statePath: env.STATE_PATH?.trim() || '.crossly-bot-state.json',
    priceDrop: {
      enabled: bool(env, 'PRICE_DROP_ENABLED', true),
      percent: num(env, 'PRICE_DROP_PERCENT', 10, { min: 1, max: 50 }),
      staleDays: num(env, 'PRICE_DROP_STALE_DAYS', 14, { min: 1, max: 365 }),
      minPrice: num(env, 'PRICE_DROP_MIN_PRICE', 5, { min: 0, max: 100000 }),
      hourUtc: num(env, 'PRICE_DROP_HOUR_UTC', 15, { min: 0, max: 23 }),
      maxPerRun: num(env, 'PRICE_DROP_MAX_PER_RUN', 25, { min: 1, max: 1000 }),
      dryRun: bool(env, 'PRICE_DROP_DRY_RUN', true),
    },
  };
}
