# `llm-feedback-middleware` Tech Debt Tracker

**Last updated:** 2026-04-24

This file tracks known tech debt across the framework. Each item has:

- **ID** — stable handle (H1, M2, D3, L7, ...)
- **Severity** — High / Medium / Low
- **Status** — Open / In Progress / Resolved
- **Affected files** — concrete pointers
- **Problem / Impact / Resolution path**

When an item is resolved, set Status to `Resolved` with a date and a commit/PR reference. Don't delete resolved items — they're an audit trail.

The full **§10.4** of [IMPLEMENTATION-PLAN.md](../A02-Building-a-Learning-Loop-Every-LLM-Output-as-Training-Signal/IMPLEMENTATION-PLAN.md) lists these as gates that MUST close before v1.0.0 publish.

---

## Severity scale

- **High** — correctness, observability, or security gap. Must close before v1.0.0.
- **Medium** — testing rigor or design inconsistency. Should close before v1.0.0; will be reviewed at the F4 gate.
- **Low** — polish that the OSS community expects from a v1.0.0 framework (CHANGELOG, SECURITY.md, READMEs, etc.).

---

## High severity (correctness / observability / scaling)

### H1: Direct-publish errors swallowed when outbox is configured

**Status:** ✅ Resolved 2026-04-24 (Phase F2.6)
**Affected:** [`packages/core/src/create-feedback.ts`](packages/core/src/create-feedback.ts)

**Resolution.** Added `onPublishError?: (event, err) => void` to `CreateFeedbackOptions`. Both code paths fire it: outbox-configured path catches and forwards to the callback; non-outbox path forwards then re-throws. 3 tests in `packages/core/tests/observability.test.ts` verify behavior.

**Original problem.** When `outbox` was configured alongside `eventBus`, the framework fired a direct publish as a fast path and ignored errors with the comment "outbox scanner will retry." If the bus was broken for hours, the outbox backlog grew but there was no metric, log, or callback to surface the fast-path failure to operators.

---

### H2: Subscriber error handlers swallow silently

**Status:** ✅ Resolved 2026-04-24 (Phase F2.6)
**Affected:**

- [`packages/postgres/src/event-store.ts`](packages/postgres/src/event-store.ts)
- [`packages/redis-pubsub/src/event-bus.ts`](packages/redis-pubsub/src/event-bus.ts)

**Resolution.**

- `PostgresEventStoreOptions` gains `onError?: (err, context: { phase: "poll" | "handler" }) => void`. Polling loop and handler dispatch in `subscribeAll` now forward errors. Loop continues so transient hiccups don't kill the stream; cursor advances past poison-pill events.
- `RedisPubSubOptions` gains `onError?: (err, context: { phase: "parse" | "handler"; topic? }) => void`. Both `pmessage` and `message` listeners forward parse failures and handler throws.

Default behavior (no callback) preserved as silent for backward compatibility.

---

### H3: `loadHistory` reads entire partition stream into memory

**Status:** ✅ Resolved 2026-04-24 (Phase F2.6)
**Affected:** [`packages/core/src/create-feedback.ts`](packages/core/src/create-feedback.ts), [`packages/core/src/ports/event-store-port.ts`](packages/core/src/ports/event-store-port.ts), in-memory + Postgres adapters

**Resolution.**

1. Added `EventStorePort.readStreamSince(partitionKey, sinceTimestamp): AsyncIterable<FeedbackEvent>` to the port.
2. In-memory adapter: filters in JS by timestamp parse + `>= cutoff`.
3. Postgres adapter: `WHERE partition_key = $1 AND timestamp >= $2 ORDER BY event_position ASC`.
4. `loadHistory` rewritten to call `readStreamSince(partitionKey, isoCutoff)`. No longer iterates the whole partition.
5. Conformance suite gains 2 tests: respects timestamp cutoff, scopes by partition_key.

Test in `packages/core/tests/observability.test.ts` verifies `loadHistory` uses `readStreamSince` (and not the unbounded `readStream`).

---

### H4: Outbox scanner has no leader election

**Status:** ✅ Resolved 2026-04-24 (Phase F2.6)
**Affected:** [`packages/postgres/src/outbox-scanner.ts`](packages/postgres/src/outbox-scanner.ts)

**Resolution.** Implemented option 1 (Postgres advisory locks). `OutboxScannerOptions` gains optional `pool` and `lockKey` parameters:

- When `pool` is provided, each tick acquires `pg_try_advisory_lock(<lockKey>)` on a dedicated client. Non-leader ticks return early (no work, just reschedule).
- Lock is released on a dedicated `pg_advisory_unlock` call at the end of every tick (and in the stop function).
- Default `lockKey` is `0x006f7800`; consumers can override per-scanner if running multiple scanners in the same Postgres.
- Without `pool`, behavior is unchanged (single-instance assumption).

JSDoc on the option marks it "STRONGLY RECOMMENDED for multi-instance deployments." Conformance for outbox-scanner is part of M4 (open) since it requires a real DB plus race injection.

---

### H5: Per-topic publish atomicity for at-least-once buses

**Status:** Open (deferred — only matters with at-least-once buses)
**Affected:** [`packages/core/src/create-feedback.ts`](packages/core/src/create-feedback.ts) — `Promise.all(topics.map(topic => bus.publish(topic, event)))`

**Problem.** Fan-out to all 7 canonical topics uses `Promise.all`. If topic 4 fails after topics 1-3 succeeded, retry will re-publish topics 1-3.

**Impact.** Duplicate deliveries on partial failure with at-least-once buses (Kafka, SQS, Redis Streams). Doesn't matter for at-most-once Redis pub/sub (current default).

**Resolution.** When a Kafka or Streams adapter ships, add per-topic publish tracking in the outbox row (e.g., `published_topics: TEXT[]`) so the scanner resumes from where it left off. Document for now.

---

## Medium severity (testing rigor)

### M1: Middleware unit tests

**Status:** ✅ Resolved 2026-04-24 (commit `4cbe189`)
**Resolution.** F2.5 added `packages/core/tests/middleware.test.ts` with 23 tests covering all 8 framework middlewares.

---

### M2: OutboxPort conformance suite

**Status:** ✅ Resolved 2026-04-24 (commit `4cbe189`)
**Resolution.** F2.5 added `packages/adapter-conformance/src/outbox-conformance.ts` with 9 tests. Wired into in-memory tests (passing) and postgres tests (will run in CI).

---

### M3: InferenceRulesPort conformance suite

**Status:** ✅ Resolved 2026-04-24 (commit `4cbe189`)
**Resolution.** F2.5 added `packages/adapter-conformance/src/inference-rules-conformance.ts` with 9 tests. Wired into in-memory + postgres tests.

---

### M4: Conformance suites only cover happy paths

**Status:** Open
**Affected:** All conformance files in `packages/adapter-conformance/src/`

**Problem.** No fault injection. Adapter rejects publish then recovers? Subscriber handler throws and other subscribers should still get the event? Unspecified.

**Impact.** Production adapter implementers can pass conformance and still ship buggy behavior under partial failure.

**Resolution.** Add fault-injection variants:

- `runEventBusConformance` with `injectFailureRate` option that randomly throws on publish and verifies retry/recovery
- `runEventStoreConformance` with a "concurrent appends serialize" test
- `runProjectionStoreConformance` with a "transactional rollback rolls back projection state" test (when adapter supports tx)

---

### M5: Bus conformance setTimeout flakiness

**Status:** Open
**Affected:** [`packages/adapter-conformance/src/event-bus-conformance.ts`](packages/adapter-conformance/src/event-bus-conformance.ts)

**Problem.** Tests use fixed `setTimeout` waits (50-200ms) to await async delivery. On slow CI, intermittent failures.

**Resolution.** Replace with a `pollWithTimeout(predicate, timeoutMs)` helper that returns as soon as the predicate matches, with a generous max timeout (1-2s).

---

### M6: No automated regression for core ↔ adapter typecheck linkage

**Status:** Open

**Problem.** If a port interface in `core` changes shape, only the adapters that import from `@core` directly fail typecheck. A future adapter that adds intermediate type layers might silently miss the update.

**Resolution.** Add a CI step that builds adapters against the freshly built core dist (rather than from workspace alias) and runs typecheck. Catches subtle linkage issues.

---

## Medium severity (design corners)

### D1: Bus pattern matcher duplicated

**Status:** Open
**Affected:**

- [`packages/in-memory/src/event-bus.ts`](packages/in-memory/src/event-bus.ts) — local `matches` function
- [`packages/redis-pubsub/src/event-bus.ts`](packages/redis-pubsub/src/event-bus.ts) — local `matchesLocal` function

**Problem.** Both adapters implement the framework's `*` and `>` topic-pattern semantics independently. Any new bus adapter needs the same code.

**Resolution.** Hoist to `packages/core/src/topic-matcher.ts` as a shared pure function. Update both adapters to import.

---

### D2: `runMigrations` runs all SQL files every time

**Status:** Open
**Affected:** [`packages/postgres/src/migrate.ts`](packages/postgres/src/migrate.ts)

**Problem.** Every call re-runs every SQL file. Works because all framework migrations are `CREATE IF NOT EXISTS`-idempotent, but it's not a real migration runner.

**Impact.** Consumers may assume `runMigrations` tracks state and write follow-up migrations that aren't idempotent. Surprise breakage.

**Resolution.** Either:

1. Add a `feedback_migrations(filename, applied_at)` tracking table; only run unapplied files.
2. Document loudly that `runMigrations` is bootstrap-only and recommend Knex / node-pg-migrate / Flyway for production migration management.

---

### D3: Schema upcaster mechanism

**Status:** Open (planned for F3)

**Problem.** The framework spec promises schema evolution as a contract: `v1.x → v1.y` upgrades never require log mutation; readers upcast on the fly. Currently no implementation. Events are emitted at `event_version: 1` with no migration path.

**Resolution.** Land in F3:

- `EventUpcaster` interface in core
- `createFeedback({ upcasters: [v1ToV2, v2ToV3], currentSchemaVersion: 3 })` registration
- Reader path applies upcaster chain
- Validator at boot ensures no missing version links

---

### D4: In-memory event store grows unbounded

**Status:** Open
**Affected:** [`packages/in-memory/src/event-store.ts`](packages/in-memory/src/event-store.ts)

**Problem.** No eviction. Tests are short-lived so it doesn't matter, but if a consumer uses the in-memory store for "small deployments without Postgres" (which the README implicitly suggests is fine), OOM is real.

**Resolution.** Add optional `{ maxEvents: number }` option. When the cap is hit, drop the oldest. Document the eviction policy and mark the in-memory store as test-or-toy use only.

---

### D5: SubscribeOptions.deliveryMode and fromPosition ignored

**Status:** Open
**Affected:** [`packages/in-memory/src/event-bus.ts`](packages/in-memory/src/event-bus.ts), [`packages/redis-pubsub/src/event-bus.ts`](packages/redis-pubsub/src/event-bus.ts)

**Problem.** Both adapters accept `SubscribeOptions` but ignore `deliveryMode` and `fromPosition`. Misleading: consumers think they're configuring something.

**Resolution.** Either:

1. Document explicitly that the options are "advisory" and adapters that don't support them ignore.
2. Throw at registration time when an unsupported option is passed (loud failure).

Recommend (2) for safety.

---

### D6: `>` wildcard not in framework spec

**Status:** Open

**Problem.** The in-memory bus and redis-pubsub adapter both support `>` as a "match all remaining segments" wildcard (NATS-style). The framework spec only mentions `*`. Inconsistent documentation.

**Resolution.** Either add `>` to the spec or remove it from adapters. Recommend keeping `>` and adding to spec — it's useful and consistent with NATS conventions.

---

## Low severity (polish, blocking publish per Apache 2.0 conventions)

### L1: CHANGELOG.md missing

**Status:** Open

**Resolution.** Changesets generates per-package changelogs on first release. Add a top-level `CHANGELOG.md` that aggregates the story and mark it auto-generated or hand-curated as appropriate.

---

### L2: SECURITY.md missing

**Status:** Open

**Resolution.** Standard OSS file with vulnerability reporting instructions. Use GitHub Security Advisories.

---

### L3: Per-package READMEs incomplete

**Status:** Partial
**Affected:** `packages/core/`, `packages/adapter-conformance/`

**Problem.** `core` and `adapter-conformance` have README placeholders. The other packages have substantial READMEs.

**Resolution.** Write proper per-package READMEs covering: install, quickstart, public API surface, link to spec.

---

### L4: No bundle-size budgets

**Status:** Open

**Resolution.** Add `size-limit` or `bundlewatch` to each package's `package.json` and CI. Lock current sizes as the baseline.

---

### L5: Node version matrix

**Status:** Open
**Affected:** `.github/workflows/ci.yml`

**Problem.** CI tests Node 22 only. Engines field claims `>= 18`.

**Resolution.** Add a CI matrix step that runs tests against Node 18, 20, and 22.

---

### L6: No example for `withTransaction` from a consumer's perspective

**Status:** Open

**Problem.** All current examples use `createFeedback`'s internal transaction. A consumer might want to wrap "capture + my-own-side-effect" atomically. We should show that.

**Resolution.** Add `examples/transactional-side-effect/` demonstrating `feedback.withTransaction(async tx => { capture(...); insertCustomRow(tx); })` semantics. Update event store port if needed to expose `withTransaction` to consumers (currently internal).

---

### L7: Examples don't shut down cleanly on capture errors

**Status:** Open
**Affected:** [`examples/postgres-redis/src/index.ts`](examples/postgres-redis/src/index.ts), [`examples/postgres-only/src/index.ts`](examples/postgres-only/src/index.ts)

**Problem.** If `feedback.capture` throws, we leak the pool, the bus, and the scanner.

**Resolution.** Wrap in `try/finally` so resources always release.

---

## Summary

| Severity            | Open                          | In Progress | Resolved | Total  |
| ------------------- | ----------------------------- | ----------- | -------- | ------ |
| High                | 1 (H5, deferred to Kafka/SQS) | 0           | 4        | 5      |
| Medium (test rigor) | 3                             | 0           | 3        | 6      |
| Medium (design)     | 6                             | 0           | 0        | 6      |
| Low (polish)        | 7                             | 0           | 0        | 7      |
| New (F2.6)          | 2                             | 0           | 0        | 2      |
| **Total**           | **19**                        | **0**       | **7**    | **26** |

**Pre-publish gate:** all 19 remaining open items must move to "In Progress" or "Resolved" before v1.0.0 publishes to npm. See [IMPLEMENTATION-PLAN.md §10.4 and §10.5](../A02-Building-a-Learning-Loop-Every-LLM-Output-as-Training-Signal/IMPLEMENTATION-PLAN.md).

**Recently resolved:**

- M1, M2, M3 (test debt) — F2.5, commit `4cbe189`
- H1, H2, H3, H4 (observability + scaling) — F2.6, commit pending

## New tech debt discovered during F2.6

### N1: Outbox `markFailed` uses string concatenation for interval

**Status:** Open (Low)
**Affected:** [`packages/postgres/src/outbox.ts`](packages/postgres/src/outbox.ts) — `($3::int || ' milliseconds')::interval`

**Problem.** Postgres interval construction via string concatenation is awkward. Currently safe because `$3` is a parameterized integer (no SQL injection), but a future contributor extending this might introduce risk.

**Resolution.** Switch to `make_interval(secs => $3 / 1000.0)` or use a fully parameterized form. Low priority.

### N2: Advisory-lock leader election not exercised in tests

**Status:** Open (Medium, folded into M4)
**Affected:** [`packages/postgres/src/outbox-scanner.ts`](packages/postgres/src/outbox-scanner.ts)

**Problem.** The H4 fix added `pool` + `lockKey` parameters for advisory-lock-based leader election but no test races two scanners and asserts only one publishes.

**Resolution.** Add a Postgres-only test that starts two scanners with the same lock key, captures publishes from each, asserts no duplicates. Folded into M4 (fault-injection conformance) for now.
