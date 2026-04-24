import type { FeedbackEvent, CaptureInput, EventFilter } from "../event-types.js";

export interface RebuildResult {
  projectionName: string;
  eventsProcessed: number;
  durationMs: number;
}

export type Unsubscribe = () => Promise<void>;

/**
 * The framework's public API. Consumer business logic imports this.
 *
 * One port covers both write (capture) and read (query, subscribe, rebuild).
 * No CQRS split at this interface level. If async / split-store CQRS is
 * needed later, this port can split into FeedbackCommandPort and
 * FeedbackQueryPort without breaking consumers materially.
 */
export interface FeedbackPort {
  /** Capture a feedback signal. Returns the new event_id. */
  capture(input: CaptureInput): Promise<string>;

  /** Read the raw event stream for a partition. */
  readStream(partitionKey: string, fromVersion?: number): AsyncIterable<FeedbackEvent>;

  /** Read all events matching a filter. */
  readAll(filter?: EventFilter, pageSize?: number): AsyncIterable<FeedbackEvent>;

  /** Rebuild a projection from the event log (admin operation). */
  rebuildProjection(name: string): Promise<RebuildResult>;

  /** Query the current state of a registered projection. */
  queryProjection<T = unknown>(name: string, filter: unknown, pageSize?: number): Promise<T[]>;
}
