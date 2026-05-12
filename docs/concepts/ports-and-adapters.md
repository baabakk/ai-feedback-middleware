# Ports and adapters

The framework is organized as a small core that defines _ports_ and a set
of swappable _adapters_ that implement them. This is the same pattern as
hexagonal architecture or "clean architecture", applied to a single
domain (feedback events) rather than a whole application.

## The ports

| Port                  | What it abstracts                               | Reference adapters                      |
| --------------------- | ----------------------------------------------- | --------------------------------------- |
| `EventStorePort`      | Durable, ordered, partitioned event log         | `in-memory`, `postgres`                 |
| `ProjectionStorePort` | Queryable derived state                         | `in-memory`, `postgres`                 |
| `EventBusPort`        | Transient publish/subscribe dispatch            | `in-memory`, `redis-pubsub`             |
| `OutboxPort`          | Transactional outbox for at-least-once dispatch | `in-memory`, `postgres`                 |
| `DedupeStorePort`     | Idempotency keys                                | `in-memory`, `postgres`                 |
| `MetricsPort`         | Counters / histograms                           | `noopMetrics` (default), bring-your-own |
| `InferenceRulesPort`  | Threshold-based inference rules                 | `in-memory`, `postgres`                 |

`FeedbackPort` is the consumer-facing facade. It is composed from the
ports above by `createFeedback()`.

## Why ports

A port is a _contract_: a TypeScript interface plus a behavioral
expectation. Adapters implement the contract for a specific
infrastructure (Postgres, Redis, S3, MongoDB, EventStoreDB, etc.).

The benefit is operational: you can switch infrastructure without
rewriting code. Want to migrate from Postgres to EventStoreDB? Write a
new adapter, run conformance, swap it in. Want to add Kafka instead of
Redis pub/sub? Same drill, no consumer code changes.

The cost is one layer of indirection. The framework keeps that layer thin
so the cost is small.

## Conformance

A type-only contract is not enough. Adapters can satisfy an interface
without honoring its semantics (idempotency, ordering, partition
isolation, retry behavior). The
[`@ai-feedback-middleware/adapter-conformance`](../../packages/adapter-conformance/README.md)
package ships vitest suites that lock down the runtime contract:

```typescript
import { runEventStoreConformance } from "@ai-feedback-middleware/adapter-conformance";
import { createMyAdapter } from "../src/index.js";

runEventStoreConformance({
  name: "MyAdapter",
  factory: async () =>
    createMyAdapter({
      /* ... */
    }),
  cleanup: async (a) => {
    /* ... */
  },
});
```

If your adapter passes every applicable suite, it is interchangeable with
the reference implementations. If it does not, the suite tells you which
behavior is wrong before consumers find out the hard way.

## Capability advertisement

Some methods are optional. `EventBusPort.subscribeGroup` (Kafka-style
consumer groups) and `EventStorePort.readStreamSince` (timestamp-bounded
scan) are required by some flows, optional for adapters that cannot
support them. Adapters either implement the optional method or omit it,
and the framework feature-detects:

```typescript
if (eventStore.readStreamSince) {
  // bounded scan path
} else {
  // fallback to readStream + JS filter
}
```

`SubscribeOptions` work the same way: adapters declare a
`SubscribeCapabilities` object listing what they support, and
`assertSupportedSubscribeOptions` throws a descriptive error when a
consumer asks for something the adapter cannot honor (e.g.
`at-least-once` on Redis pub/sub).

## Why no ORM

The framework treats the event log as primary. An ORM would put a row
abstraction between the log and the consumer, and the row abstraction
would slowly grow capabilities (relations, eager loads, batch updates)
that conflict with the event-sourcing model. We use raw SQL through the
adapter and let the adapter do exactly what the port contract requires.

For consumer-side derived tables (projections), bring whatever ORM you
like. The framework does not care.
