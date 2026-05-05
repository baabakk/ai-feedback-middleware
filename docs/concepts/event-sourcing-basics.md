# Event sourcing basics

The framework is event-sourced: the canonical state of the world is the
append-only log of `feedback_events`. Everything else (projections,
counters, dashboards, suggested examples) is a derived view.

## Why event sourcing

Conventional CRUD throws away the _journey_. You see the current row, not
the sequence of edits that produced it. For a learning system that is the
opposite of what you want: the journey is the training signal.

Event sourcing keeps the journey:

- **Reproducibility**: rebuild any projection from the log.
- **Auditability**: every state change is timestamped and attributable.
- **Forward compatibility**: write events once, read them through whatever
  schema version your code is on (via [upcasters](#upcasters)).
- **Undo by replay**: drop a projection table, rebuild from the log.
  The log is immutable; mistakes in derivation are cheap to fix.

## The append-only log

`EventStorePort` exposes:

- `append(events, tx?)` - write one or more events atomically.
- `readStream(partition_key)` - iterate events for a single partition.
- `readStreamSince(partition_key, sinceTimestamp)` - bounded scan; the
  framework uses this for `loadHistory` so memory stays linear in the
  recent slice, not in the full lifetime.
- `readAll(filter)` - cross-partition scan for projections.
- `subscribeAll(handler, fromPosition)` - tail the log for async work.
- `withTransaction(fn)` - run a unit of work transactionally.

The log is partitioned by `partition_key` (defaults to `artifact_id`).
Within a partition, events are strictly ordered. Across partitions, order
is per-store.

## Projections

A projection is a function from the event stream to a queryable state.
The framework ships a thin runtime (`ProjectionEngine`) that lets you
register builders:

```typescript
const approvalCount: ProjectionBuilder<{ producer: string; count: number }> = {
  name: "approval_count_by_producer",
  mode: "sync",
  applies: (e) => e.action === "approve",
  keyFor: (e) => e.producer,
  apply: (event, current) => ({
    producer: event.producer,
    count: (current?.count ?? 0) + 1,
  }),
};
```

Two modes:

- **`sync`** - applied inside the same transaction as the event append.
  Useful when consumers need read-your-writes consistency. Slightly
  slower writes; instant projection updates.
- **`async`** - applied via the bus + outbox. Useful for projections
  driven by analytics queries that can tolerate slight staleness.
  Faster writes; eventual projection consistency.

Projections are rebuildable. `feedback.rebuildProjection(name)` re-runs
the builder over the entire log and replaces the projection state with the
re-derived value. Use this when you change a builder, fix a bug, or
recover from a partial outage.

## Why partition keys matter

Partitioning is the framework's only ordering primitive. Within a
partition you get strict ordering and atomicity. Across partitions you
get throughput.

Choose your partition key to match the unit you reason about. For most
LLM-feedback workloads that is the artifact (default). If you scale to
many concurrent threads of conversation per artifact, switch to
`(artifact_id, thread_id)`.

A common mistake is using a low-cardinality partition key (the user id,
say) which serializes all that user's events. Per-artifact is usually
right.

## Upcasters

Events live forever; code does not. The framework's upcaster mechanism
lets you read old events through new code without rewriting the log:

```typescript
const upcasters: EventUpcaster[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    upcast: (event) => ({ ...event, event_version: 2, new_field: deriveNew(event) }),
  },
];
```

Pass `upcasters` to `createFeedback`. The framework validates the chain
at composition time (no gaps, no skips) and applies it transparently on
read. Writers continue writing the latest version; readers always see the
latest shape.

Upcasters are deterministic and pure. No I/O, no clock, no random.

## What this is not

- **Not a message queue.** The bus is a separate concern (next page).
  Events live in the store; the bus is best-effort dispatch.
- **Not a database replacement.** Use it for the events you want to learn
  from, not for operational state.
- **Not free.** Append-only logs grow. Plan a retention policy per
  artifact type via `ArtifactTypeRegistry`.
