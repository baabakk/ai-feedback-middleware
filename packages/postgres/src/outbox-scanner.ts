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
}

const defaultBackoff = (attemptCount: number): number =>
  Math.min(60_000, 1000 * Math.pow(4, attemptCount));

/**
 * Periodic scanner that drains the outbox to the bus.
 *
 * Returns a stop function. Safe to run on a single instance; for multi-instance
 * deployments, use Postgres advisory locks or a leader-election library to
 * ensure only one scanner is active at a time.
 */
export function startOutboxScanner(options: OutboxScannerOptions): () => Promise<void> {
  const intervalMs = options.intervalMs ?? 30_000;
  const batchSize = options.batchSize ?? 100;
  const backoff = options.backoff ?? defaultBackoff;
  const log =
    options.log ??
    ((level, message, fields) => {
      if (level === "error") console.error(`[outbox-scanner] ${message}`, fields);
    });

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
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
  };
}
