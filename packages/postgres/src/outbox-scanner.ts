import type { Pool, PoolClient } from "pg";
import type { EventBusPort, FeedbackEvent, OutboxPort } from "@llm-feedback-middleware/core";

export interface OutboxScannerOptions {
  outbox: OutboxPort;
  eventBus: EventBusPort;
  /** How often to scan for unpublished rows. Default 30s. */
  intervalMs?: number;
  /** Max rows picked per scan. Default 100. */
  batchSize?: number;
  /** Backoff in ms for failed publishes. Default exponential 1s/4s/16s/... */
  backoff?: (attemptCount: number) => number;
  /** Optional pre-publish hook (apply middleware, e.g. retry/logging). */
  onPublish?: (event: FeedbackEvent, topics: string[]) => Promise<void>;
  /** Optional logger. */
  log?: (level: "info" | "warn" | "error", message: string, fields: object) => void;

  /**
   * Optional Postgres pool for advisory-lock-based leader election.
   *
   * When provided, each scanner tick acquires a session-level advisory lock
   * via `pg_try_advisory_lock(<lockKey>)` on a single dedicated client. If
   * another scanner instance already holds the lock, the tick is a no-op.
   *
   * STRONGLY RECOMMENDED for multi-instance deployments. Without it,
   * concurrent scanners will all pick up the same outbox rows and emit
   * duplicate publishes.
   */
  pool?: Pool;
  /**
   * Advisory lock key (any 32-bit signed int). Default `0x6f7800` (`o,x,_`).
   * Pick a distinct value per scanner if you have multiple scanners running
   * in the same Postgres (e.g., one per tenant).
   */
  lockKey?: number;
}

const DEFAULT_LOCK_KEY = 0x006f7800; // ascii ".ox."

const defaultBackoff = (attemptCount: number): number =>
  Math.min(60_000, 1000 * Math.pow(4, attemptCount));

/**
 * Periodic scanner that drains the outbox to the bus.
 *
 * Returns a stop function. For multi-instance deployments, pass `pool` to
 * enable advisory-lock-based leader election (only one scanner does work at
 * a time even if multiple processes start the scanner).
 */
export function startOutboxScanner(options: OutboxScannerOptions): () => Promise<void> {
  const intervalMs = options.intervalMs ?? 30_000;
  const batchSize = options.batchSize ?? 100;
  const backoff = options.backoff ?? defaultBackoff;
  const lockKey = options.lockKey ?? DEFAULT_LOCK_KEY;
  const log =
    options.log ??
    ((level, message, fields) => {
      if (level === "error") {
        console.error(`[outbox-scanner] ${message}`, fields);
      }
    });

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let leaseClient: PoolClient | null = null;

  /**
   * Acquire the advisory lock on a dedicated client; return true on success.
   * Caller MUST hold onto the client and pass it back to releaseLock when
   * done so the lock is released cleanly.
   */
  async function tryAcquireLock(): Promise<PoolClient | null> {
    if (!options.pool) return null; // no pool means no leader election; caller treats null as "go"
    const client = await options.pool.connect();
    try {
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [lockKey],
      );
      if (result.rows[0]?.acquired) return client;
      client.release();
      return null;
    } catch (err) {
      client.release();
      throw err;
    }
  }

  async function releaseLock(client: PoolClient): Promise<void> {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    } catch {
      // best-effort; lock auto-releases when the connection closes
    } finally {
      client.release();
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;

    // If a pool was supplied, try to acquire the leader lock for this tick.
    // No pool = no leader election (caller accepts the duplicate-publish risk).
    if (options.pool) {
      try {
        leaseClient = await tryAcquireLock();
      } catch (err) {
        log("error", "advisory-lock acquire failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!stopped) timer = setTimeout(tick, intervalMs);
        return;
      }
      if (!leaseClient) {
        // Another scanner is the leader for this tick. Reschedule.
        if (!stopped) timer = setTimeout(tick, intervalMs);
        return;
      }
    }

    try {
      const rows = await options.outbox.pickUnpublished(batchSize);
      for (const row of rows) {
        if (stopped) break;
        try {
          if (options.onPublish) {
            await options.onPublish(row.event, row.topics);
          } else {
            await Promise.all(
              row.topics.map((topic) => options.eventBus.publish(topic, row.event)),
            );
          }
          await options.outbox.markPublished(row.event_id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await options.outbox.markFailed(row.event_id, message, backoff(row.attempt_count));
          log("warn", "outbox publish failed; will retry", {
            event_id: row.event_id,
            attempt_count: row.attempt_count + 1,
            error: message,
          });
        }
      }
    } catch (err) {
      log("error", "outbox scan failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (leaseClient) {
        const client = leaseClient;
        leaseClient = null;
        await releaseLock(client);
      }
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
      }
    }
  }

  // Kick off immediately
  timer = setTimeout(tick, 0);

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (leaseClient) {
      const client = leaseClient;
      leaseClient = null;
      await releaseLock(client);
    }
  };
}
