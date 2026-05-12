# postgres-only

Postgres-backed example using `@ai-feedback-middleware/postgres`.

## Run

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/feedback \
  pnpm --filter postgres-only start
```

The example runs framework migrations on first run (idempotent), captures three events (2 approves, 1 edit), reads the partition stream for one artifact, queries the `approval_count_by_producer` projection, and demonstrates rebuilding the projection from the event log.

## What it shows

- Connecting to Postgres via a `pg` Pool
- One-shot `runMigrations(pool)` to bootstrap framework tables
- Composing the framework with `createPostgresEventStore` + `createPostgresProjectionStore`
- Sync projection updates within capture
- Rebuilding a projection by replaying the immutable log
