/**
 * Backing store for the idempotency middleware.
 *
 * Subscribers can wrap their handler with `idempotencyMiddleware(store)` so
 * the same event is not processed twice (when the bus delivers at-least-once
 * or when an outbox scanner replays after a crash).
 */
export interface DedupeStorePort {
  /** Has this dedup key been seen? */
  seen(key: string): Promise<boolean>;

  /** Mark a dedup key as seen for a window of time (ms). */
  mark(key: string, ttlMs: number): Promise<void>;
}
