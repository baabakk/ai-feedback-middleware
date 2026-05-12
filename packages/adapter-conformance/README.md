# `@ai-feedback-middleware/adapter-conformance`

Conformance test suites that any adapter implementing an
`@ai-feedback-middleware/core` port must pass. Drop these into your adapter's
test directory; if every suite passes, your adapter is interchangeable with
the in-memory and Postgres reference implementations.

## Why this exists

Adapters can satisfy a TypeScript interface without honoring its semantics
(idempotency, ordering, partition isolation, retry behavior). The conformance
suites lock down the runtime contract so you can swap one adapter for another
without surprises.

## Install

```bash
pnpm add -D @ai-feedback-middleware/adapter-conformance @ai-feedback-middleware/core
# vitest is a peer dependency
pnpm add -D vitest
```

## Suites

| Suite                           | Port                  | Tests                                                                                |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `runEventStoreConformance`      | `EventStorePort`      | append + read, partition isolation, ordering, `readStreamSince` cutoff, transactions |
| `runProjectionStoreConformance` | `ProjectionStorePort` | upsert, query, idempotent rebuild, transactional rollback                            |
| `runEventBusConformance`        | `EventBusPort`        | publish/subscribe round-trip, topic filtering, multi-subscriber fan-out, wildcards   |
| `runDedupeStoreConformance`     | `DedupeStorePort`     | claim once, claim returns false on retry, expiry                                     |
| `runOutboxConformance`          | `OutboxPort`          | enqueue, fetchPendingBatch, markPublished, markFailed, advisory-lock leadership      |
| `runInferenceRulesConformance`  | `InferenceRulesPort`  | upsert, list, evaluate threshold + window                                            |

Each suite registers a vitest `describe(...)` block. Wire it from your
adapter's test file:

```typescript
import { runEventStoreConformance } from "@ai-feedback-middleware/adapter-conformance";
import { createMyAdapter } from "../src/index.js";

runEventStoreConformance({
  name: "MyAdapter",
  factory: async () =>
    createMyAdapter({
      /* ... */
    }),
  cleanup: async (adapter) => {
    /* tear down: drop tables, close connection, etc. */
  },
});
```

The reference adapter implementations all use these suites:

- `packages/in-memory/tests/conformance.test.ts` runs every applicable suite.
- `packages/postgres/tests/conformance.test.ts` runs the four that touch
  durable storage (gated on `FEEDBACK_TEST_DATABASE_URL`).
- `packages/redis-pubsub/tests/conformance.test.ts` runs the bus suite (gated
  on `FEEDBACK_TEST_REDIS_URL`).

## Adding a new port

When the framework adds a new port, add a corresponding conformance suite in
`packages/adapter-conformance/src/`. Then:

1. Import the suite from in-memory + Postgres tests so the reference adapters
   stay green.
2. Document the suite in this README's table above.
3. Mention the suite in `IMPLEMENTATION-PLAN.md` §10.4 or §10.5 if it's a
   blocker for a release gate.

## Design invariants

- **Suites are vitest `describe` blocks.** They register tests at module load
  and assume the consumer is running them inside a vitest runner.
- **Suites accept a factory + cleanup callback.** They never construct
  adapters themselves; the consumer's test file owns the lifecycle.
- **Suites do not assume durability semantics they cannot verify.**
  At-least-once vs at-most-once, ordering, retention, etc. are advertised by
  the adapter's `SubscribeCapabilities` and tested per capability.

## License

Apache 2.0
