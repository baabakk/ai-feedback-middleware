import type { FeedbackEvent } from "../event-types.js";
import type { DedupeStorePort } from "../ports/dedupe-store-port.js";
import type { Middleware } from "./types.js";

export interface IdempotencyOptions {
  /** Store backing the dedup state. */
  store: DedupeStorePort;
  /** Time-to-live for dedup keys, in milliseconds. Default 24 hours. */
  ttlMs?: number;
  /** Subscriber name; combined with event_id to scope dedup per subscriber. */
  subscriberName: string;
}

/**
 * Drop duplicate deliveries to a subscriber. The dedup key is
 * `<subscriberName>:<event_id>`. If the key is already marked, the
 * downstream handler is not called.
 *
 * Useful when the bus delivers at-least-once or when an outbox scanner
 * replays after a crash.
 */
export function idempotencyMiddleware(options: IdempotencyOptions): Middleware<FeedbackEvent> {
  const ttl = options.ttlMs ?? 24 * 60 * 60 * 1000;
  return (next) => async (event) => {
    const key = `${options.subscriberName}:${event.event_id}`;
    if (await options.store.seen(key)) {
      return; // already processed
    }
    await next(event);
    await options.store.mark(key, ttl);
  };
}
