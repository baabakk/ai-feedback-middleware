# Postgres setup

The `@ai-feedback-middleware/postgres` package implements
`EventStorePort`, `ProjectionStorePort`, `OutboxPort`, `DedupeStorePort`,
and `InferenceRulesPort` against a Postgres database. It is the
production-default storage adapter for most consumers.

## Prerequisites

- Postgres 14+ (15 or 16 recommended).
- A database the framework can `CREATE TABLE` in. The framework owns
  six tables prefixed `feedback_`. Granting the framework's role
  ownership of those tables is the simplest setup.
- The `pg` Node driver in your project: `pnpm add pg`.

## Install

```bash
pnpm add @ai-feedback-middleware/postgres pg
```

## Run migrations

The package ships migrations and a one-call runner:

```typescript
import pg from "pg";
import { runMigrations } from "@ai-feedback-middleware/postgres";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const result = await runMigrations(pool);
console.log(`Applied ${result.applied.length} migrations`);
```

The runner is idempotent and bootstrap-only. For production,
[track migrations with a real runner](#migration-management-tradeoff) so
you can add custom ones later.

## Compose the framework

```typescript
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  createPostgresOutbox,
  createPostgresInferenceRulesStore,
  createPostgresDedupeStore,
} from "@ai-feedback-middleware/postgres";
import { createFeedback, DEFAULT_ACTIONS } from "@ai-feedback-middleware/core";

const feedback = createFeedback({
  eventStore: createPostgresEventStore({ pool }),
  projectionStore: createPostgresProjectionStore({ pool }),
  outbox: createPostgresOutbox({ pool }),
  inferenceRules: createPostgresInferenceRulesStore({ pool }),
  dedupeStore: createPostgresDedupeStore({ pool }),
  actions: DEFAULT_ACTIONS,
  artifactTypes: [{ name: "draft" }],
});
```

## Tables created

| Table                      | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `feedback_events`          | The append-only event log.                                    |
| `feedback_projections`     | Derived state, keyed by `(projection_name, key)`.             |
| `feedback_outbox`          | Pending bus dispatches with attempt tracking.                 |
| `feedback_dedupe`          | Idempotency keys with TTL.                                    |
| `feedback_inference_rules` | Configurable threshold rules.                                 |
| `feedback_migrations`      | (Reserved) - planned tracking table for the migration runner. |

The schemas are declared with `IF NOT EXISTS` so re-running migrations
is safe.

## Indexing

Default indexes cover the framework's read paths:

- `feedback_events(partition_key, event_position)` for `readStream`.
- `feedback_events(partition_key, timestamp)` for `readStreamSince`.
- `feedback_outbox(published_at, next_attempt_at)` for the outbox scanner.
- `feedback_dedupe(expires_at)` for cleanup.

If you add your own projections that scan event_type-equivalent fields,
add a partial index for the predicate that matters most.

## Outbox scanner

The outbox scanner runs separately from the framework wiring:

```typescript
import { startOutboxScanner } from "@ai-feedback-middleware/postgres";

const stop = startOutboxScanner({
  outbox: createPostgresOutbox({ pool }),
  eventBus,
  intervalMs: 1000,
  pool, // STRONGLY RECOMMENDED for multi-instance deployments
  lockKey: 0x006f7800,
  onPublish: async (event, topics) => {
    await Promise.all(topics.map((t) => eventBus.publish(t, event)));
  },
});
```

Pass `pool` to enable `pg_try_advisory_lock`-based leader election so two
replicas of your service do not double-publish. Without `pool`, behavior
is unchanged (single-instance assumption).

## Migration-management tradeoff

The shipped `runMigrations` re-runs every SQL file every time. It is
safe (all migrations are `CREATE IF NOT EXISTS`) but it is not a real
migration runner. For production:

- Either accept the bootstrap behavior and let the framework own its
  schema lifecycle, or
- Use a proper migration tool (Knex, node-pg-migrate, Flyway) and
  point it at the framework's migration files plus your own.

A first-class migration tracker is on the roadmap (see
[`TECH-DEBT.md`](../../TECH-DEBT.md) item D2).

## Connection pooling

The adapters take a `pg.Pool` and do not own it. Size the pool
appropriately for your workload:

- 1 connection per concurrent capture is a safe starting point.
- The outbox scanner needs its own connection for the advisory lock.
- The bus subscriber on the consumer side does not need a pool
  connection.

## Cleanup

```typescript
await pool.end();
```

The framework holds no other connections. There is no `feedback.shutdown()`
to call.
