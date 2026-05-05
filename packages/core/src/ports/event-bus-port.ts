import type { FeedbackEvent } from "../event-types.js";

export interface SubscribeOptions {
  /** at-most-once: subscriber may miss events if down. at-least-once: redelivery on crash. */
  deliveryMode?: "at-most-once" | "at-least-once";
  /** Adapter-specific cursor. "earliest" replays from retention window; "latest" starts now. */
  fromPosition?: string | "earliest" | "latest";
}

export type Unsubscribe = () => Promise<void>;

/**
 * Transient dispatch of events to subscribers.
 *
 * Distinct from EventStorePort: the bus is best-effort delivery, the store
 * is the source of truth. Subscribers that miss bus messages can always
 * catch up by reading from the event log via EventStorePort.
 *
 * Optional methods (publishBatch, subscribeGroup) are capability-advertised.
 * Adapters that lack a feature simply do not implement the optional method;
 * callers feature-detect via `if (bus.subscribeGroup) { ... }`.
 */
export interface EventBusPort {
  /** Publish a single event to a topic. */
  publish(topic: string, event: FeedbackEvent): Promise<void>;

  /** Optional: publish a batch of events under one topic for efficiency. */
  publishBatch?(topic: string, events: FeedbackEvent[]): Promise<void>;

  /**
   * Subscribe to a topic (or array of topics). Returns an unsubscribe function.
   * Topic wildcards are adapter-dependent (Redis PSUBSCRIBE, Kafka regex, etc.).
   */
  subscribe(
    topic: string | string[],
    handler: (event: FeedbackEvent, topic: string) => Promise<void>,
    options?: SubscribeOptions,
  ): Unsubscribe;

  /**
   * Optional: load-balanced consumption across multiple subscribers in the
   * same `groupId`. Each event is delivered to exactly one member of the
   * group. Maps to Kafka consumer groups, Redis Streams XREADGROUP, SQS, etc.
   */
  subscribeGroup?(
    topic: string,
    groupId: string,
    handler: (event: FeedbackEvent, topic: string) => Promise<void>,
  ): Unsubscribe;
}

/**
 * Build the canonical set of topics for a feedback event.
 *
 * Publishers emit to multiple topics per event so subscribers can filter
 * narrowly (`feedback.captured.explicit.positive`) or broadly (`feedback.captured`).
 */
export function topicsFor(event: FeedbackEvent): string[] {
  const topics: string[] = [
    "feedback.captured",
    `feedback.captured.${event.source}`,
    `feedback.captured.${event.source}.${event.polarity}`,
    `feedback.inference.${event.inference}`,
    `feedback.artifact.${event.artifact_type}`,
    `feedback.producer.${event.producer}`,
    `feedback.action.${event.action}`,
  ];
  if (event.correction_of) {
    topics.push("feedback.correction");
  }
  return topics;
}
