import { Hono } from 'hono';
import { verifyWebhook, WebhookVerificationError } from '@crossly/sdk';
import type { CrosslyEvent } from './events.js';
import { handleEvent } from './handlers.js';

export interface Bindings {
  /** `wrangler secret put CROSSLY_WEBHOOK_SECRET` in production; `.dev.vars` locally. */
  CROSSLY_WEBHOOK_SECRET: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.get('/healthz', (c) => c.json({ ok: true }));

app.post('/webhooks/crossly', async (c) => {
  // Hono never parses the body on its own, so this is the exact text Crossly signed.
  // Do NOT call c.req.json() before verifying.
  const raw = await c.req.text();

  let event: CrosslyEvent;
  try {
    event = (await verifyWebhook(raw, c.req.header('crossly-signature'), c.env.CROSSLY_WEBHOOK_SECRET)) as unknown as CrosslyEvent;
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      // A missing secret is our problem, not Crossly's: 500 keeps the delivery retrying.
      const status = err.reason === 'missing_secret' || err.reason === 'no_crypto' ? 500 : 400;
      console.warn(`rejected webhook: ${err.reason}`);
      return c.json({ error: { code: err.reason, message: err.message } }, status);
    }
    if (err instanceof SyntaxError) {
      return c.json({ error: { code: 'invalid_payload', message: 'Body is not JSON.' } }, 400);
    }
    throw err;
  }

  // Answer within Crossly's 10-second window and do the work afterwards.
  // waitUntil keeps the Worker alive until handleEvent settles.
  c.executionCtx.waitUntil(
    handleEvent(event).catch((err: unknown) => {
      console.error(`handler failed for ${event.type} ${event.id}`, err);
    }),
  );
  return c.json({ received: true, deliveryId: c.req.header('crossly-delivery-id') ?? null });
});

export default app;
