import type { CapturedEvaluatedReactionEvent, EventFilter, FeedbackEvent } from "../event-types.js";

/**
 * Opaque transaction handle. Adapters define their own concrete type.
 * Callers pass `tx` through transparently; they never inspect it.
 */
export type Transaction = unknown;

/**
 * Durable storage for the event log. Source of truth.
 *
 * Implementations: in-memory (for tests), Postgres (production), SQLite
 * (default thin/local), and potentially future EventStoreDB / Kafka-as-store
 * backends.
 *
 * In v2.1 the event log is the union of two tables (`captured_artifacts` and
 * `captured_evaluated_reactions`). The store interface exposes both via the
 * same `FeedbackEvent` discriminated union; adapters route to the right
 * physical table based on `event_kind`.
 */
export interface EventStorePort {
  /**
   * Run `work` inside a transaction. Adapters that lack real transactions
   * (e.g., in-memory) call `work(undefined)` directly and treat the whole
   * thing as a single logical operation. Postgres opens a connection,
   * BEGIN, runs work(client), and COMMITs (or ROLLBACKs on throw).
   */
  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;

  /** Append a single event. May participate in an enclosing transaction. */
  append(event: FeedbackEvent, tx?: Transaction): Promise<void>;

  /** Append a batch of events atomically. */
  appendBatch(events: FeedbackEvent[], tx?: Transaction): Promise<void>;

  /** Read all events for a single partition, in event_position order. */
  readStream(partitionKey: string, fromVersion?: number): AsyncIterable<FeedbackEvent>;

  /**
   * Read events for a single partition with timestamp >= sinceTimestamp,
   * in event_position order. Cutoff is pushed to the storage layer.
   * `sinceTimestamp` is ISO-8601; events with timestamps that fail to parse
   * are excluded.
   */
  readStreamSince(partitionKey: string, sinceTimestamp: string): AsyncIterable<FeedbackEvent>;

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

  /**
   * Layer 4 helper: read recent reaction events on a partition within a
   * sliding window, scoped to a specific artifact_type when provided. Used by
   * `recordReaction` to assemble candidate reactions for inline actionability
   * inference.
   */
  readRecentReactions(input: {
    partition_key: string;
    artifact_type?: string;
    since_timestamp: string;
    tx?: Transaction;
  }): Promise<CapturedEvaluatedReactionEvent[]>;

  /**
   * Layer 4 helper: return the set of artifact_ids in `candidates` that have
   * been tombstoned (`cancelled`, `corrected`, or `superseded_by`). Used to
   * filter inference candidates direction-symmetrically per spec §12.4.
   */
  readTombstonedArtifactIds(input: {
    candidate_artifact_ids: string[];
    tx?: Transaction;
  }): Promise<Set<string>>;
}
