# @ai-feedback-middleware/postgres

Postgres adapters for `ai-feedback-middleware`. Implements `EventStorePort` and `ProjectionStorePort`.

## Install

```bash
npm install @ai-feedback-middleware/postgres pg
```

## Use

```typescript
import { Pool } from "pg";
import { createFeedback, DEFAULT_ACTIONS } from "@ai-feedback-middleware/core";
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  runMigrations,
} from "@ai-feedback-middleware/postgres";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// One-time bootstrap: create the framework's tables.
await runMigrations(pool);

const feedback = createFeedback({
  eventStore: createPostgresEventStore({ pool }),
  projectionStore: createPostgresProjectionStore({ pool }),
  actions: DEFAULT_ACTIONS,
  artifactTypes: [{ name: "draft" }],
});
```

## Tables

Three tables, all idempotent:

- `feedback_events` — append-only event log
- `feedback_projections` — generic key/value state for all projections
- `feedback_projection_checkpoints` — per-projection cursor

Migration SQL ships under `migrations/`. The `runMigrations(pool)` helper applies them in order. Consumers preferring their own migration runner (Knex, node-pg-migrate, Flyway) can import the raw SQL files instead.

## subscribeAll

The Postgres adapter implements `subscribeAll` via polling (default 500ms). For higher-frequency or true push semantics, use the dedicated bus adapter (e.g., `@ai-feedback-middleware/redis-pubsub`) and reserve Postgres for durable storage.

## Conformance

This adapter passes the full `runEventStoreConformance` and `runProjectionStoreConformance` suites from `@ai-feedback-middleware/adapter-conformance`.

## License

Apache 2.0
