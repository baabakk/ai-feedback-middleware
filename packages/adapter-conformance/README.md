# @llm-feedback-middleware/adapter-conformance

Conformance test suites that any adapter implementing an `llm-feedback-middleware` port must pass.

## What this is

When you write a new adapter (e.g. for MongoDB, EventStoreDB, Kafka-as-store, Cloud Spanner), drop these test suites into your adapter package's tests directory and they exercise the full port contract. If they pass, your adapter is interchangeable with the in-memory and Postgres reference implementations.

## Suites

- `runEventStoreConformance(adapterFactory)` — the `EventStorePort` contract
- `runProjectionStoreConformance(storeFactory)` — the `ProjectionStorePort` contract

Each suite registers a `describe(...)` block with vitest. Call from your adapter's test file:

```typescript
import { runEventStoreConformance } from "@llm-feedback-middleware/adapter-conformance";
import { createMyAdapter } from "../src/index.js";

runEventStoreConformance({
  name: "MyAdapter",
  factory: async () =>
    createMyAdapter({
      /* ... */
    }),
  cleanup: async (adapter) => {
    /* optional teardown */
  },
});
```

## Adding a new suite

When the framework adds a new port (e.g. `EventBusPort` in F2), add a corresponding conformance suite here. All adapters of that port are then required to pass it.

## License

Apache 2.0
