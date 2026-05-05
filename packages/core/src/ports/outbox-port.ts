import type { FeedbackEvent } from "../event-types.js";
import type { Transaction } from "./event-store-port.js";

/**
 * Transactional outbox: records events that need to be published to the
 * event bus. Inserted in the same DB transaction as the event log append,
 * so the outbox row exists if and only if the event is durable.
 *
 * A scanner periodically picks up unpublished rows, publishes them through
 * the bus + middleware pipeline, and marks them published. If the bus is
 * down, the scanner retries with backoff.
 */
export interface OutboxPort {
  /** Enqueue an event for later publishing. Joins the enclosing transaction. */
  enqueue(event: FeedbackEvent, topics: string[], tx?: Transaction): Promise<void>;

  /**
   * Yield up to `limit` outbox rows that are eligible for publishing.
   * Eligibility = not yet published AND next_attempt_at <= now.
   */
  pickUnpublished(limit: number): Promise<OutboxRow[]>;

  /** Mark a row as successfully published. */
  markPublished(eventId: string): Promise<void>;

  /** Record a publish failure: increment attempt count, schedule next attempt. */
  markFailed(eventId: string, error: string, nextAttemptInMs: number): Promise<void>;

  /** Bookkeeping for the dashboard / observability. */
  backlogSize(): Promise<number>;
  oldestUnpublishedAgeMs(): Promise<number | null>;
}

export interface OutboxRow {
  event_id: string;
  topics: string[];
  enqueued_at: string;
  attempt_count: number;
  last_error: string | null;
  /** Full event payload (may be denormalized into the outbox or fetched from the store). */
  event: FeedbackEvent;
}
