import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import app from '../src/index.js';

const SECRET = 'whsec_test_secret';
const env = { CROSSLY_WEBHOOK_SECRET: SECRET };

const sign = (body: string, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const body = JSON.stringify({
  id: 'evt_1',
  type: 'test.ping',
  created: '2026-11-27T12:00:00.000Z',
  data: { message: 'Hello from Crossly!', timestamp: '2026-11-27T12:00:00.000Z' },
});

/** A minimal ExecutionContext: records waitUntil promises so the test can await them. */
function executionContext() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {}, props: {} },
  };
}

async function deliver(payload: string, signature?: string, bindings: Record<string, string> = env) {
  const { ctx, pending } = executionContext();
  const req = new Request('https://worker.example/webhooks/crossly', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature ? { 'crossly-signature': signature } : {}), 'crossly-delivery-id': 'dlv_1' },
    body: payload,
  });
  const res = await app.fetch(req, bindings, ctx as never);
  await Promise.all(pending);
  return { res, pending };
}

describe('Worker POST /webhooks/crossly', () => {
  it('accepts a signed delivery and schedules the handler with waitUntil', async () => {
    const { res, pending } = await deliver(body, sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, deliveryId: 'dlv_1' });
    expect(pending).toHaveLength(1);
  });

  it('rejects a tampered body with 400', async () => {
    const { res, pending } = await deliver(body.replace('Hello', 'Hullo'), sign(body));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_signature');
    expect(pending).toHaveLength(0);
  });

  it('rejects a stale timestamp with 400', async () => {
    const { res } = await deliver(body, sign(body, Math.floor(Date.now() / 1000) - 3600));
    expect(res.status).toBe(400);
  });

  it('rejects a missing signature with 400', async () => {
    const { res } = await deliver(body);
    expect(res.status).toBe(400);
  });

  it('answers 500 when the secret binding is missing, so Crossly retries', async () => {
    const { res } = await deliver(body, sign(body), {});
    expect(res.status).toBe(500);
  });

  it('serves a health check', async () => {
    const res = await app.fetch(new Request('https://worker.example/healthz'), env, executionContext().ctx as never);
    expect(await res.json()).toEqual({ ok: true });
  });
});
