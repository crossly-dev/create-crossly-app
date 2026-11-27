import express, { type Express } from 'express';
import { verifyWebhook, WebhookVerificationError } from '@crossly/sdk';
import type { CrosslyEvent } from './events.js';
import { handleEvent, type Logger } from './handlers.js';

export interface AppOptions {
  /** The endpoint's signing secret from Settings → API & webhooks → Webhooks. */
  secret: string;
  /** Your event handler. Defaults to ./handlers.ts. */
  onEvent?: (event: CrosslyEvent, log: Logger) => unknown | Promise<unknown>;
  log?: Logger;
  /** Replay window in seconds (Crossly's documented default is 300). */
  toleranceSeconds?: number;
  /** Clock override in unix seconds, for tests. */
  now?: () => number;
}

/**
 * Remembers event ids already handled. Crossly delivers at least once: a retry or
 * a manual redelivery carries the SAME `event.id`, so this keeps a handler from
 * running twice. In-memory, so it resets on restart and is per process: use your
 * database (a unique index on the event id) in production.
 */
class SeenEvents {
  private ids = new Set<string>();
  constructor(private readonly max = 10_000) {}
  has(id: string) {
    return this.ids.has(id);
  }
  add(id: string) {
    this.ids.add(id);
    if (this.ids.size > this.max) this.ids.delete(this.ids.values().next().value as string);
  }
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const log = options.log ?? console;
  const onEvent = options.onEvent ?? handleEvent;
  const seen = new SeenEvents();

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // The webhook route is registered BEFORE express.json() below, and uses
  // express.raw() so req.body is the exact Buffer Crossly signed. Verifying
  // JSON.stringify(req.body) instead fails on genuine events: key order and
  // number formatting do not survive a parse/stringify round trip.
  app.post('/webhooks/crossly', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    let event: CrosslyEvent;
    try {
      event = (await verifyWebhook(raw, req.get('crossly-signature'), options.secret, {
        toleranceSeconds: options.toleranceSeconds,
        nowSeconds: options.now?.(),
      })) as unknown as CrosslyEvent;
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        // A server-side problem must not look like Crossly's fault: 500 keeps it retrying.
        const status = err.reason === 'missing_secret' || err.reason === 'no_crypto' ? 500 : 400;
        log.warn(`rejected webhook: ${err.reason}`);
        res.status(status).json({ error: { code: err.reason, message: err.message } });
        return;
      }
      if (err instanceof SyntaxError) {
        res.status(400).json({ error: { code: 'invalid_payload', message: 'Body is not JSON.' } });
        return;
      }
      throw err;
    }

    if (seen.has(event.id)) {
      res.json({ received: true, duplicate: true });
      return;
    }

    // Crossly waits at most 10 seconds for the 2xx. Keep this fast: put slow work on a queue.
    await onEvent(event, log);
    seen.add(event.id);
    res.json({ received: true });
  });

  // Everything else in your app can parse JSON as usual.
  app.use(express.json());

  return app;
}
