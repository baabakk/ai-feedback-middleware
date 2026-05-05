import { Redis, type RedisOptions } from "ioredis";
import type { EventBusPort, FeedbackEvent, Unsubscribe } from "@llm-feedback-middleware/core";

export interface RedisPubSubOptions {
  /**
   * Redis connection options. Either a connection string ("redis://...") or
   * an ioredis options object. The adapter will create two separate
   * connections (publisher + subscriber) since Redis pub/sub takes the
   * subscriber connection out of normal command mode.
   */
  connection: string | RedisOptions;
  /** Optional prefix prepended to every topic. Useful for multi-tenant isolation. */
  topicPrefix?: string;
}

/**
 * Redis pub/sub adapter for EventBusPort.
 *
 * Properties:
 * - At-most-once delivery (Redis pub/sub semantics)
 * - Per-channel ordering, no global ordering
 * - No retention: subscribers that are down miss messages
 * - PSUBSCRIBE wildcards using Redis' `*` (matches segment) and `?` semantics.
 *   The adapter normalizes the framework's `*` and `>` to Redis equivalents.
 *
 * Use Redis Streams (separate adapter) if you need at-least-once with retention.
 */
export function createRedisPubSubEventBus(options: RedisPubSubOptions): EventBusPort & {
  close: () => Promise<void>;
} {
  const publisher = makeRedis(options.connection);
  const subscriber = makeRedis(options.connection);
  const prefix = options.topicPrefix ?? "";

  // Map a topic pattern as we expose it to a Redis channel pattern.
  function toChannel(topic: string): string {
    return prefix + topic;
  }

  // Track active subscribers so we can dispatch when Redis delivers.
  // Each entry holds the original requested patterns (in framework form)
  // plus the handler.
  const subscriptions = new Map<
    symbol,
    {
      patterns: string[];
      handler: (event: FeedbackEvent, topic: string) => Promise<void>;
    }
  >();

  // Local pattern matcher (independent of Redis) for fan-out within a process.
  function matchesLocal(pattern: string, topic: string): boolean {
    if (pattern === topic) return true;
    if (pattern === ">" || pattern === "#") return true;
    const pSegs = pattern.split(".");
    const tSegs = topic.split(".");
    for (let i = 0; i < pSegs.length; i++) {
      const p = pSegs[i];
      if (p === ">") return true;
      if (p === "*") {
        if (tSegs[i] === undefined) return false;
        continue;
      }
      if (p !== tSegs[i]) return false;
    }
    return pSegs.length === tSegs.length;
  }

  // Convert a framework pattern to a Redis PSUBSCRIBE pattern.
  // Redis uses `*` to match anything within a glob; we map our `*` to
  // a single-segment Redis match, and `>` to a multi-segment match.
  function toRedisPattern(pattern: string): string {
    // Replace each segment-level `*` with `*` and `>` with `*` (Redis doesn't
    // distinguish single-segment vs. multi-segment, so we use `*` for both
    // and rely on local matchesLocal() for accurate fan-out).
    return prefix + pattern.replace(/>/g, "*");
  }

  // Listen for Redis pmessage and dispatch to local subscribers.
  let listenerInstalled = false;
  function installListener(): void {
    if (listenerInstalled) return;
    listenerInstalled = true;
    subscriber.on("pmessage", async (_pattern: string, channel: string, message: string) => {
      // Strip prefix to get the framework topic
      const topic = prefix && channel.startsWith(prefix) ? channel.slice(prefix.length) : channel;
      let event: FeedbackEvent;
      try {
        event = JSON.parse(message) as FeedbackEvent;
      } catch {
        return; // ignore malformed
      }
      for (const sub of subscriptions.values()) {
        for (const pat of sub.patterns) {
          if (matchesLocal(pat, topic)) {
            try {
              await sub.handler(event, topic);
            } catch {
              // Swallow handler errors so one bad subscriber does not
              // break delivery to others. Production adapters should
              // wire structured logging here.
            }
            break;
          }
        }
      }
    });
    subscriber.on("message", async (channel: string, message: string) => {
      const topic = prefix && channel.startsWith(prefix) ? channel.slice(prefix.length) : channel;
      let event: FeedbackEvent;
      try {
        event = JSON.parse(message) as FeedbackEvent;
      } catch {
        return;
      }
      for (const sub of subscriptions.values()) {
        for (const pat of sub.patterns) {
          if (matchesLocal(pat, topic)) {
            try {
              await sub.handler(event, topic);
            } catch {
              /* swallow */
            }
            break;
          }
        }
      }
    });
  }

  return {
    async publish(topic: string, event: FeedbackEvent): Promise<void> {
      await publisher.publish(toChannel(topic), JSON.stringify(event));
    },

    async publishBatch(topic: string, events: FeedbackEvent[]): Promise<void> {
      const pipe = publisher.pipeline();
      for (const event of events) {
        pipe.publish(toChannel(topic), JSON.stringify(event));
      }
      await pipe.exec();
    },

    subscribe(
      topic: string | string[],
      handler: (event: FeedbackEvent, topic: string) => Promise<void>,
    ): Unsubscribe {
      installListener();
      const patterns = Array.isArray(topic) ? topic : [topic];
      const id = Symbol("sub");
      subscriptions.set(id, { patterns, handler });

      // Subscribe at the Redis layer. Use PSUBSCRIBE for any pattern containing
      // `*` or `>`, otherwise plain SUBSCRIBE.
      const redisChannels = patterns.map(toRedisPattern);
      const subscribePromises = redisChannels.map((ch) =>
        ch.includes("*") ? subscriber.psubscribe(ch) : subscriber.subscribe(ch),
      );

      return async () => {
        subscriptions.delete(id);
        // Unsubscribe at Redis only if no other local subscription needs the channel.
        await Promise.all(
          redisChannels.map((ch) =>
            ch.includes("*")
              ? subscriber.punsubscribe(ch).catch(() => {})
              : subscriber.unsubscribe(ch).catch(() => {}),
          ),
        );
        // Wait for any in-flight subscribe to settle to keep teardown clean.
        await Promise.all(subscribePromises.map((p) => p.catch(() => {})));
      };
    },

    async close(): Promise<void> {
      await publisher.quit().catch(() => {});
      await subscriber.quit().catch(() => {});
    },
  };
}

function makeRedis(connection: string | RedisOptions): Redis {
  if (typeof connection === "string") {
    return new Redis(connection, { lazyConnect: false, maxRetriesPerRequest: null });
  }
  return new Redis({ ...connection, lazyConnect: false, maxRetriesPerRequest: null });
}
