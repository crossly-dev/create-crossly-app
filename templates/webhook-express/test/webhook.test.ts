import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { CrosslyEvent } from '../src/events.js';

const SECRET = 'whsec_test_secret';
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

const sign = (body: string, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const sale = JSON.stringify({
  id: 'evt_1',
  type: 'sale.detected',
  created: '2026-11-27T12:00:00.000Z',
  data: { saleId: 's1', orderId: 'o1', inventoryItemId: null, platform: 'ebay', platformOrderId: null, salePrice: 84, platformFee: 16.8 },
});

let server: Server | undefined;
afterEach(() => server?.close());

async function start(onEvent = vi.fn()) {
  server = createApp({ secret: SECRET, onEvent, log: quiet }).listen(0);
  await new Promise<void>((r) => server!.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: string, signature?: string) =>
    fetch(`${base}/webhooks/crossly`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature ? { 'crossly-signature': signature } : {}) },
      body,
    });
  return { base, post, onEvent };
}

describe('POST /webhooks/crossly', () => {
  it('accepts a correctly signed delivery and hands the typed event to the handler', async () => {
    const { post, onEvent } = await start();
    const res = await post(sale, sign(sale));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    const event = onEvent.mock.calls[0]![0] as CrosslyEvent;
    expect(event.type).toBe('sale.detected');
    if (event.type === 'sale.detected') expect(event.data.salePrice).toBe(84);
  });

  it('rejects a tampered body with 400 bad_signature', async () => {
    const { post, onEvent } = await start();
    const res = await post(sale.replace('84', '1'), sign(sale));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_signature');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('rejects a replay older than five minutes with 400', async () => {
    const { post } = await start();
    const res = await post(sale, sign(sale, Math.floor(Date.now() / 1000) - 3600));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('timestamp_out_of_tolerance');
  });

  it('rejects a missing header with 400 malformed_header', async () => {
    const { post } = await start();
    const res = await post(sale);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('malformed_header');
  });

  it('runs the handler once per event id (retries carry the same id)', async () => {
    const { post, onEvent } = await start();
    expect((await post(sale, sign(sale))).status).toBe(200);
    const again = await post(sale, sign(sale));
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('answers 500 when the handler throws, so Crossly retries', async () => {
    const { post } = await start(vi.fn().mockRejectedValue(new Error('db down')));
    expect((await post(sale, sign(sale))).status).toBe(500);
  });

  it('leaves the rest of the app parsing JSON normally', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/healthz`);
    expect(await res.json()).toEqual({ ok: true });
  });
});
