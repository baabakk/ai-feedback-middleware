import type { FeedbackEvent, EventFilter } from "../event-types.js";

/**
 * Opaque transaction handle. Adapters define their own concrete type.
 * Callers pass `tx` through transparently; they never inspect it.
 */
export type Transaction = unknown;

/**
 * Durable storage for the event log. Source of truth.
 *
 * Implementations: in-memory (for tests), Postgres (production), and
 * potentially future EventStoreDB / Kafka-as-store backends.
 */
export interface EventStorePort {
  /** Append a single event. May participate in an enclosing transaction. */
  append(event: FeedbackEvent, tx?: Transaction): Promise<void>;

  /** Append a batch of events atomically. */
  appendBatch(events: FeedbackEvent[], tx?: Transaction): Promise<void>;

  /** Read all events for a single partition, in event_position order. */
  readStream(partitionKey: string, fromVersion?: number): AsyncIterable<FeedbackEvent>;

  /** Read all events matching a filter, paged. */
  readAll(filter?: EventFilter, pageSize?: number): AsyncIterable<FeedbackEvent>;

  /**
   * Subscribe to all events as they are appended. Returns an unsubscribe function.
   * Optional position cursor (string) lets subscribers resume from a previous point.
   */
  subscribeAll(
    handler: (event: FeedbackEvent) => Promise<void>,
    fromPosition?: string,
  ): () => Promise<void>;
}
