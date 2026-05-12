# Choosing a bus

The event bus is how subscribers find out about new events. The framework
treats the bus as best-effort dispatch on top of the durable event store
(see [event sourcing basics](../concepts/event-sourcing-basics.md)), so
the bus's delivery guarantees affect throughput and ergonomics but never
correctness.

## Decision tree

1. **Single process, tests, prototypes:** `@ai-feedback-middleware/in-memory`.
   Zero infrastructure. No durability. Subscribers in the same process.
2. **Cross-process, single Redis, OK with at-most-once:**
   `@ai-feedback-middleware/redis-pubsub`. Lightest cross-process
   option. If a subscriber is down, it misses messages that fire while
   it is down. Subscribers can backfill from the event store on startup.
3. **At-least-once required:** Kafka or Redis Streams. No reference
   adapter ships yet; the port (`EventBusPort`) is ready and the
   conformance suite covers what you need to validate.
4. **Cloud-managed at-least-once:** SNS+SQS, Pub/Sub, EventBridge.
   Same story as Kafka: write the adapter, run conformance, swap in.

## Capability declarations

Each adapter declares a `SubscribeCapabilities` object listing supported
`deliveryMode` and `fromPosition` values. The framework's
`assertSupportedSubscribeOptions` throws a descriptive error when a
consumer asks for something the adapter cannot honor:

```typescript
import { createInMemoryEventBus } from "@ai-feedback-middleware/in-memory";

const bus = createInMemoryEventBus();
// Throws: 'createInMemoryEventBus does not support deliveryMode="at-least-once"'.
bus.subscribe("feedback.>", handler, { deliveryMode: "at-least-once" });
```

This means you can write subscriber code targeting a delivery profile
and trust the framework to fail loud at boot rather than silently miss
events later.

## At-most-once vs. at-least-once tradeoffs

| Concern               | At-most-once (Redis pub/sub)       | At-least-once (Kafka, Streams, SQS)   |
| --------------------- | ---------------------------------- | ------------------------------------- |
| Lost messages         | Possible if subscriber is down     | None (within retention)               |
| Duplicate messages    | None                               | Possible (handler must be idempotent) |
| Subscriber bootstrap  | Needs to backfill from event store | Automatic (consumer group resumes)    |
| Throughput            | Highest                            | Lower (acknowledgments, replication)  |
| Operational footprint | Smallest                           | Larger (broker, partitions)           |

Most consumers start at-most-once because they can already query the
event store. They graduate to at-least-once when they stand up a service
that _cannot_ tolerate the brief gaps that at-most-once allows (e.g.
billing, audit log fan-out, cross-region replication).

## The transactional outbox

Whichever bus you choose, pair it with the outbox if you want
exactly-once-effect dispatch. The outbox writes the event and the
intent-to-publish in the same transaction, then a separate scanner
drains the outbox to the bus. If the bus is down, the scanner retries.
If the scanner crashes mid-flight, the lock is released and another
replica picks up.

See [Postgres setup](./postgres-setup.md) for the scanner's
advisory-lock leader election.

## Topic conventions

The framework publishes every captured event to a fan of seven topics:

```
feedback.captured
feedback.captured.<source>
feedback.captured.<source>.<polarity>
feedback.inference.<inference>
feedback.artifact.<artifact_type>
feedback.producer.<producer>
feedback.action.<action>
```

Subscribers filter at the topic level using the framework's
`matchesTopic` semantics (`*` single-segment, `>` tail). Adapters whose
underlying transport has stricter or weaker matching subscribe at the
broadest pattern that still catches everything and re-filter on receive
via `matchesTopic`. See [the spec](../../../A02-Feedback-Middleware-Framework-Spec.md)
§9.2.1 for the wildcard reference.
