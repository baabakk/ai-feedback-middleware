# @llm-feedback-middleware/redis-pubsub

Redis pub/sub adapter for `EventBusPort`.

## Install

```bash
npm install @llm-feedback-middleware/redis-pubsub ioredis
```

## Use

```typescript
import { createRedisPubSubEventBus } from "@llm-feedback-middleware/redis-pubsub";

const bus = createRedisPubSubEventBus({
  connection: process.env.REDIS_URL ?? "redis://localhost:6379",
  topicPrefix: "fbm.",
});

await bus.publish("feedback.captured", event);

const unsub = bus.subscribe("feedback.captured.*", async (event, topic) => {
  console.log(`got ${event.event_id} on ${topic}`);
});

// Later
await unsub();
await bus.close();
```

## Properties

- **At-most-once delivery.** Subscribers down at publish time miss messages. Use `@llm-feedback-middleware/redis-streams` (F2 follow-up) if you need at-least-once with retention.
- **No global ordering.** Per-channel only.
- **Wildcards.** `*` matches one segment, `>` matches the rest. Internally maps to Redis `PSUBSCRIBE` with pattern matching plus a local matcher for precision.
- **Two connections.** Redis pub/sub takes the subscriber connection out of normal command mode, so the adapter creates separate publisher and subscriber clients.

## License

Apache 2.0
