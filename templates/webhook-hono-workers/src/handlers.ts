import type { CrosslyEvent } from './events.js';

/**
 * Your business logic. Runs AFTER the 200 went back (via waitUntil), so a slow call
 * here does not time the delivery out. The trade-off: a failure here is not retried
 * by Crossly. For work that must not be lost, send the event to a Cloudflare Queue
 * here instead and process it from the queue consumer.
 *
 * Deliveries are at-least-once: dedupe on `event.id` (KV or D1) if a handler must
 * not run twice.
 */
export async function handleEvent(event: CrosslyEvent): Promise<void> {
  switch (event.type) {
    case 'sale.detected':
      console.log(`[sale] ${event.data.platform} sold for $${event.data.salePrice ?? '?'}`);
      break;
    case 'order.created':
      console.log(`[order] ${event.data.orderId}: ${event.data.quantity} unit(s), address ${event.data.addressPending ? 'pending' : 'ready'}`);
      break;
    case 'order.shipped':
      console.log(`[order] ${event.data.orderId} shipped ${event.data.trackingNumber ?? ''}`);
      break;
    case 'listing.delisted':
      console.log(`[listing] ${event.data.listingId} delisted on ${event.data.platform}`);
      break;
    case 'offer.received':
      console.log(`[offer] ${(event.data.offerCents / 100).toFixed(2)} on ${event.data.platform}`);
      break;
    case 'message.received':
      console.log(`[inbox] ${event.data.buyerUsername ?? 'buyer'}: ${event.data.messageBody}`);
      break;
    case 'connection.disconnected':
      console.warn(`[account] ${event.data.platform} disconnected: ${event.data.reason}`);
      break;
    case 'test.ping':
      console.log(`[test] ${event.data.message}`);
      break;
    default:
      // New event types can appear at any time; ignore what you do not handle.
      console.log(`[unhandled] ${event.type}`);
  }
}
