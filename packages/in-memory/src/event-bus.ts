import {
  type EventBusPort,
  type FeedbackEvent,
  type SubscribeCapabilities,
  type SubscribeOptions,
  type Unsubscribe,
  assertSupportedSubscribeOptions,
  matchesTopic,
} from "@ai-feedback-middleware/core";

const CAPABILITIES: SubscribeCapabilities = {
  adapterName: "createInMemoryEventBus",
  deliveryModes: ["at-most-once"],
  fromPositions: ["latest"],
};

export interface InMemoryEventBusOptions {
  /**
   * Optional error callback fired when a subscriber handler throws. Default:
   * silent. Mirrors the redis-pubsub adapter's `onError`. Wire to a logger
   * or metrics system to gain visibility into subscriber failures.
   *
   * The bus continues dispatching to remaining subscribers even when one
   * throws — fault isolation matches the redis-pubsub adapter so swapping
   * implementations does not silently change semantics.
   */
  onError?: (err: unknown, context: { phase: "handler"; topic: string }) => void;
}

interface Subscription {
  patterns: string[];
  handler: (event: FeedbackEvent, topic: string) => Promise<void>;
}

/**
 * In-memory event bus using simple pattern matching. Supports `*` wildcards
 * (single-segment) and `>` wildcard (everything from here on, NATS-style),
 * via `matchesTopic` from `@ai-feedback-middleware/core`.
 *
 * Designed for tests and toy single-node deployments. No durability, no
 * cross-process delivery, no backpressure.
 */
export function createInMemoryEventBus(options: InMemoryEventBusOptions = {}): EventBusPort {
  const subscriptions = new Set<Subscription>();
  const onError = options.onError;

  async function dispatch(topic: string, event: FeedbackEvent): Promise<void> {
    for (const sub of subscriptions) {
      for (const pattern of sub.patterns) {
        if (matchesTopic(pattern, topic)) {
          try {
            await sub.handler(event, topic);
          } catch (err) {
            // Surface but do not let a single bad handler stop the others.
            if (onError) onError(err, { phase: "handler", topic });
          }
          break;
        }
      }
    }
  }

  return {
    async publish(topic: string, event: FeedbackEvent): Promise<void> {
      await dispatch(topic, event);
    },

    async publishBatch(topic: string, events: FeedbackEvent[]): Promise<void> {
      for (const event of events) {
        await dispatch(topic, event);
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async subscribe(
      topic: string | string[],
      handler: (event: FeedbackEvent, topic: string) => Promise<void>,
      options?: SubscribeOptions,
    ): Promise<Unsubscribe> {
      assertSupportedSubscribeOptions(options, CAPABILITIES);
      const sub: Subscription = {
        patterns: Array.isArray(topic) ? topic : [topic],
        handler,
      };
      subscriptions.add(sub);
      return async () => {
        subscriptions.delete(sub);
      };
    },
  };
}
