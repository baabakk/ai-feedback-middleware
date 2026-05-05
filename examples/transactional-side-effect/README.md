# Example: transactional side-effect

Shows how to commit (or roll back) a feedback capture and a custom
side-effect atomically by passing the same `Transaction` handle to
`eventStore.append` and to your own `pg` query inside the
`eventStore.withTransaction(async (tx) => { ... })` block.

## What it demonstrates

1. The first capture inserts a framework event and a row in a
   consumer-owned `audit_log` table. Both commit together.
2. The second capture deliberately fails the audit insert. The framework's
   event append rolls back too — `feedback_events` does not contain
   `evt-2`, and `audit_log` stays empty for that event_id.

This is the canonical pattern when consumers need read-your-writes
consistency between framework events and their own state (audit logs,
billing rows, downstream queue acks).

## Run

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/feedback \
  pnpm --filter transactional-side-effect start
```

## Notes

- The framework intentionally types `Transaction` as `unknown`. Consumers
  that wire the Postgres adapter cast it to `pg.PoolClient` (as this
  example does). When you swap adapters you cast to whatever the new
  adapter exposes; the framework code does not care.
- `withTransaction` is a primitive on `EventStorePort`. Other ports
  (projections, outbox, dedupe) accept the same `tx` handle, so you can
  layer multiple framework writes inside the same transaction with the
  consumer's writes.
- For Postgres, the transaction is a real `BEGIN ... COMMIT/ROLLBACK`. For
  the in-memory adapter, `withTransaction` calls `work(undefined)` and
  treats the whole block as atomic-by-fiat — useful in tests but no real
  rollback semantics.
