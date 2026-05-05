import type { EventBusPort, FeedbackEvent, Unsubscribe } from "@llm-feedback-middleware/core";

interface Subscription {
  patterns: string[];
  handler: (event: FeedbackEvent, topic: string) => Promise<void>;
}

/**
 * In-memory event bus using simple pattern matching. Supports `*` wildcards
 * (single-segment) and `>` wildcard (everything from here on, NATS-style).
 *
 * Designed for tests and toy single-node deployments. No durability, no
 * cross-process delivery, no backpressure.
 */
export function createInMemoryEventBus(): EventBusPort {
  const subscriptions = new Set<Subscription>();

  function matches(pattern: string, topic: string): boolean {
    if (pattern === topic) return true;
    if (pattern === ">" || pattern === "#" || pattern === "*") return true;
    const pSegs = pattern.split(".");
    const tSegs = topic.split(".");
    for (let i = 0; i < pSegs.length; i++) {
      const p = pSegs[i];
      if (p === ">") return true; // matches all remaining
      if (p === "*") {
        if (tSegs[i] === undefined) return false;
        continue;
      }
      if (p !== tSegs[i]) return false;
    }
    return pSegs.length === tSegs.length;
  }

  return {
    async publish(topic: string, event: FeedbackEvent): Promise<void> {
      for (const sub of subscriptions) {
        for (const pattern of sub.patterns) {
          if (matches(pattern, topic)) {
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
            if (matches(pattern, topic)) {
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
    ): Unsubscribe {
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
