import type { CrosslyEvent } from './events.js';

export type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

/**
 * Your business logic. `switch (event.type)` narrows `event.data` to that event's
 * documented payload, so `event.data.salePrice` is typed inside `sale.detected`.
 *
 * Money in webhook payloads is decimal dollars unless the field name says Cents.
 * Throwing here answers 500 and Crossly retries (5 attempts, backoff from 5 s).
 */
export async function handleEvent(event: CrosslyEvent, log: Logger = console): Promise<void> {
  switch (event.type) {
    case 'sale.detected': {
      const { platform, salePrice, platformFee, saleId } = event.data;
      log.info(`[sale] ${platform} sold for $${salePrice ?? '?'} (fee $${platformFee ?? '?'}), sale ${saleId}`);
      break;
    }
    case 'order.created': {
      if (event.data.addressPending) {
        log.info(`[order] ${event.data.orderId}: address not in yet; wait for order.address_available`);
        break;
      }
      for (const line of event.data.lineItems) {
        log.info(`[order] ${event.data.orderId}: ship ${line.quantity} x ${line.sku ?? line.listingId} to ${event.data.buyerAddress?.city ?? '?'}`);
      }
      break;
    }
    case 'order.address_available':
      log.info(`[order] ${event.data.orderId}: ship to ${event.data.buyerName ?? 'buyer'}, ${event.data.buyerAddress?.city ?? '?'}`);
      break;
    case 'order.shipped':
      log.info(`[order] ${event.data.orderId} shipped via ${event.data.carrier ?? '?'} ${event.data.trackingNumber ?? ''}`);
      break;
    case 'order.cancelled':
      log.info(`[order] ${event.data.orderId} cancelled${event.data.platformCancel ? ' on the marketplace' : ' (recorded locally)'}`);
      break;
    case 'order.refunded':
      log.info(`[refund] $${event.data.amount} on ${event.data.orderId}${event.data.full ? ', fully refunded' : ''}`);
      break;
    case 'listing.price_changed':
      log.info(`[listing] ${event.data.listingId}: $${event.data.oldPrice ?? '-'} -> $${event.data.newPrice}`);
      break;
    case 'listing.delisted':
      log.info(`[listing] ${event.data.listingId} came down on ${event.data.platform} (${event.data.source})`);
      break;
    case 'inventory.quantity_changed':
      if (event.data.soldOut) log.info(`[stock] ${event.data.sku ?? event.data.inventoryItemId} is sold out`);
      break;
    case 'offer.received':
      log.info(`[offer] $${(event.data.offerCents / 100).toFixed(2)} from ${event.data.buyerHandle ?? 'a buyer'} on ${event.data.platform}`);
      break;
    case 'message.received':
      log.info(`[inbox] ${event.data.buyerUsername ?? 'buyer'} on ${event.data.platform}: ${event.data.messageBody}`);
      break;
    case 'connection.disconnected':
      log.warn(`[account] ${event.data.platform} disconnected (${event.data.reason}): syncing has stopped until you reconnect`);
      break;
    case 'test.ping':
      log.info(`[test] ${event.data.message}`);
      break;
    default:
      // Crossly can add event types at any time. Log and ignore; never fail on them.
      log.info(`[unhandled] ${event.type}`);
  }
}
