import {
  type EventBusPort,
  type FeedbackEvent,
  type SubscribeCapabilities,
  type SubscribeOptions,
  type Unsubscribe,
  assertSupportedSubscribeOptions,
  matchesTopic,
} from "@llm-feedback-middleware/core";

const CAPABILITIES: SubscribeCapabilities = {
  adapterName: "createInMemoryEventBus",
  deliveryModes: ["at-most-once"],
  fromPositions: ["latest"],
};

interface Subscription {
  patterns: string[];
  handler: (event: FeedbackEvent, topic: string) => Promise<void>;
}

/**
 * In-memory event bus using simple pattern matching. Supports `*` wildcards
 * (single-segment) and `>` wildcard (everything from here on, NATS-style),
 * via `matchesTopic` from `@llm-feedback-middleware/core`.
 *
 * Designed for tests and toy single-node deployments. No durability, no
 * cross-process delivery, no backpressure.
 */
export function createInMemoryEventBus(): EventBusPort {
  const subscriptions = new Set<Subscription>();

  return {
    async publish(topic: string, event: FeedbackEvent): Promise<void> {
      for (const sub of subscriptions) {
        for (const pattern of sub.patterns) {
          if (matchesTopic(pattern, topic)) {
            await sub.handler(event, topic);
            break;
          }
        }
      }
    },

    async publishBatch(topic: string, events: FeedbackEvent[]): Promise<void> {
      for (const event of events) {
        for (const sub of subscriptions) {
          for (const pattern of sub.patterns) {
            if (matchesTopic(pattern, topic)) {
              await sub.handler(event, topic);
              break;
            }
          }
        }
      }
    },

    subscribe(
      topic: string | string[],
      handler: (event: FeedbackEvent, topic: string) => Promise<void>,
      options?: SubscribeOptions,
    ): Unsubscribe {
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
