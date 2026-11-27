import type { NotifyKind } from './config.js';

export type Notifier = (text: string) => Promise<void>;

/** The JSON each kind of incoming webhook expects. */
export function payloadFor(kind: NotifyKind, text: string): Record<string, unknown> {
  switch (kind) {
    case 'discord':
      // Discord rejects content over 2000 characters.
      return { content: text.length > 2000 ? `${text.slice(0, 1997)}...` : text, allowed_mentions: { parse: [] } };
    case 'slack':
      return { text, unfurl_links: false };
    default:
      return { text };
  }
}

export function createNotifier(
  url: string | undefined,
  kind: NotifyKind,
  { fetch: doFetch = fetch, log = console }: { fetch?: typeof fetch; log?: Pick<Console, 'info' | 'warn'> } = {},
): Notifier {
  if (!url) {
    return async (text) => {
      log.info(`[notify] ${text}`);
    };
  }
  return async (text) => {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payloadFor(kind, text)),
    });
    if (!res.ok) log.warn(`[notify] ${kind} webhook answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}

export function money(value: string | number | null | undefined, currency = 'USD'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return '?';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}
