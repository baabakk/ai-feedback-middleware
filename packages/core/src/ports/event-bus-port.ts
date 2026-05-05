import type { FeedbackEvent } from "../event-types.js";

export interface SubscribeOptions {
  /** at-most-once: subscriber may miss events if down. at-least-once: redelivery on crash. */
  deliveryMode?: "at-most-once" | "at-least-once";
  /** Adapter-specific cursor. "earliest" replays from retention window; "latest" starts now. */
  fromPosition?: string | "earliest" | "latest";
}

/**
 * Capability descriptor an adapter declares so callers can validate
 * `SubscribeOptions` at registration time. Adapters whose underlying
 * transport does not support a given option set must throw early via
 * `assertSupportedSubscribeOptions` so that broken consumer assumptions
 * surface immediately rather than silently misbehaving in production.
 *
 * @see assertSupportedSubscribeOptions
 */
export interface SubscribeCapabilities {
  /** Delivery semantics the adapter actually supports. */
  deliveryModes: ReadonlyArray<NonNullable<SubscribeOptions["deliveryMode"]>>;
  /** Cursor positions the adapter actually supports. */
  fromPositions: ReadonlyArray<NonNullable<SubscribeOptions["fromPosition"]>>;
  /** Human-readable adapter name for error messages. */
  adapterName: string;
}

/**
 * Validate consumer-supplied `SubscribeOptions` against an adapter's declared
 * capabilities. Throws a descriptive error when a consumer asks for something
 * the adapter cannot honor (e.g. `at-least-once` on Redis pub/sub).
 *
 * Adapters should call this from `subscribe()` before installing the handler.
 *
 * Default values (`at-most-once`, `latest`) and undefined options always pass.
 */
export function assertSupportedSubscribeOptions(
  options: SubscribeOptions | undefined,
  capabilities: SubscribeCapabilities,
): void {
  if (!options) return;
  if (options.deliveryMode !== undefined) {
    if (!capabilities.deliveryModes.includes(options.deliveryMode)) {
      throw new Error(
        `${capabilities.adapterName} does not support deliveryMode="${options.deliveryMode}". ` +
          `Supported: [${capabilities.deliveryModes.join(", ")}]. ` +
          `Use a different bus adapter (e.g. Kafka, Redis Streams) for at-least-once.`,
      );
    }
  }
  if (options.fromPosition !== undefined) {
    const wellKnown = options.fromPosition === "earliest" || options.fromPosition === "latest";
    if (wellKnown && !capabilities.fromPositions.includes(options.fromPosition)) {
      throw new Error(
        `${capabilities.adapterName} does not support fromPosition="${options.fromPosition}". ` +
          `Supported well-known positions: [${capabilities.fromPositions.join(", ")}]. ` +
          `For arbitrary cursors, the adapter must support a string position.`,
      );
    }
  }
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
