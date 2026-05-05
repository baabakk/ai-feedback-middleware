# `llm-feedback-middleware` Tech Debt Tracker

**Last updated:** 2026-05-05 (F4 Round 1 closures)

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

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`packages/core/src/topic-matcher.ts`](packages/core/src/topic-matcher.ts), [`packages/in-memory/src/event-bus.ts`](packages/in-memory/src/event-bus.ts), [`packages/redis-pubsub/src/event-bus.ts`](packages/redis-pubsub/src/event-bus.ts)

**Resolution.** Shipped `matchesTopic` in core as the single source of truth for the framework's `*` (single-segment) and `>` (NATS-style tail, one-or-more remaining) wildcard semantics. `#` is accepted as a synonym for `>`. Both bus adapters import and call the shared function. 14 tests in [`packages/core/tests/topic-matcher.test.ts`](packages/core/tests/topic-matcher.test.ts) cover exact match, single-segment `*`, tail `>`, `#` synonym, combined wildcards, and the partial-segment-not-supported case.

**Behavior change.** The previous in-memory matcher returned true for `>` even when there were no remaining segments to match (so `feedback.>` matched `feedback`). The shared matcher follows the spec and NATS convention: `>` requires at least one remaining segment. None of the framework's canonical topics fall foul of this since they all have at least two segments after the leading `feedback`.

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

**Status:** ✅ Resolved 2026-04-24 (Phase F3)
**Affected:** [`packages/core/src/upcaster.ts`](packages/core/src/upcaster.ts), [`packages/core/src/create-feedback.ts`](packages/core/src/create-feedback.ts)

**Resolution.** Shipped:

- `EventUpcaster` interface (`fromVersion`, `toVersion`, `upcast(event)`)
- `validateUpcasterChain` — boot-time check for contiguous chain v1 → ... → currentVersion
- `upcastEvent` and `upcastStream` — pure functions applying the chain
- `createFeedback` accepts `upcasters?: EventUpcaster[]`; both `readStream` and `readAll` automatically upcast
- 9 tests in `packages/core/tests/upcaster.test.ts`

Schema evolution contract is now backed by code: future minor-version bumps ship via upcaster registration without touching the event log.

---

### D4: In-memory event store grows unbounded

**Status:** Open
**Affected:** [`packages/in-memory/src/event-store.ts`](packages/in-memory/src/event-store.ts)

**Problem.** No eviction. Tests are short-lived so it doesn't matter, but if a consumer uses the in-memory store for "small deployments without Postgres" (which the README implicitly suggests is fine), OOM is real.

**Resolution.** Add optional `{ maxEvents: number }` option. When the cap is hit, drop the oldest. Document the eviction policy and mark the in-memory store as test-or-toy use only.

---

### D5: SubscribeOptions.deliveryMode and fromPosition ignored

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`packages/core/src/ports/event-bus-port.ts`](packages/core/src/ports/event-bus-port.ts), [`packages/in-memory/src/event-bus.ts`](packages/in-memory/src/event-bus.ts), [`packages/redis-pubsub/src/event-bus.ts`](packages/redis-pubsub/src/event-bus.ts)

**Resolution.** Implemented option (2) — loud failure. Shipped `SubscribeCapabilities` interface + `assertSupportedSubscribeOptions(options, capabilities)` helper in core. Each adapter declares the `deliveryMode` and `fromPosition` values it supports; `subscribe()` throws a descriptive error when the consumer asks for something the adapter cannot honor. Both reference adapters declare `at-most-once` + `latest` only (the actual semantics of in-memory and Redis pub/sub). 5 tests in [`packages/in-memory/tests/subscribe-options.test.ts`](packages/in-memory/tests/subscribe-options.test.ts) verify rejection messages and accepted defaults.

---

### D6: `>` wildcard not in framework spec

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`A02-Feedback-Middleware-Framework-Spec.md`](../A02-Feedback-Middleware-Framework-Spec.md) §9.2.1

**Resolution.** Added §9.2.1 "Wildcards" to the framework spec covering both `*` (single-segment) and `>` (NATS-style tail, one-or-more remaining) with worked examples. The new section also points adapter implementers at the shared `matchesTopic` source of truth in `@llm-feedback-middleware/core` and explains the per-adapter pattern of subscribing at the broadest transport-level match plus re-filtering on receive.

---

## Low severity (polish, blocking publish per Apache 2.0 conventions)

### L1: CHANGELOG.md missing

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`CHANGELOG.md`](CHANGELOG.md)

**Resolution.** Shipped a top-level `CHANGELOG.md` following Keep-a-Changelog. It aggregates the cross-package narrative (phase boundaries, tech-debt closures, breaking-vs-non-breaking decisions). Per-package changelogs will be auto-generated by Changesets on first release.

---

### L2: SECURITY.md missing

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`SECURITY.md`](SECURITY.md)

**Resolution.** Shipped `SECURITY.md` with private-disclosure instructions via GitHub Security Advisories or email, supported-version table, target response/triage SLAs, what's in/out of scope, and hardening notes for consumers. The bug-report issue template links to it as the security path.

---

### L3: Per-package READMEs incomplete

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`packages/core/README.md`](packages/core/README.md), [`packages/adapter-conformance/README.md`](packages/adapter-conformance/README.md)

**Resolution.** Both READMEs expanded to cover install, public API surface (every exported symbol grouped by concern), quickstart, design invariants, and link back to the spec. The `adapter-conformance` README also documents which conformance suites cover which ports plus a worked example of wiring one into a third-party adapter's tests.

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

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`examples/postgres-redis/src/index.ts`](examples/postgres-redis/src/index.ts), [`examples/postgres-only/src/index.ts`](examples/postgres-only/src/index.ts)

**Resolution.** Both examples now wrap their main flow in `try { ... } finally { ... }`. The Postgres pool, Redis bus, outbox scanner, and metrics subscription all release on a thrown capture. The cleanup path itself uses `.catch(() => {})` per resource so a failing teardown does not mask the original error.

---

## Summary

| Severity            | Open                          | In Progress | Resolved             | Total  |
| ------------------- | ----------------------------- | ----------- | -------------------- | ------ |
| High                | 1 (H5, deferred to Kafka/SQS) | 0           | 4 (H1, H2, H3, H4)   | 5      |
| Medium (test rigor) | 3 (M4, M5, M6)                | 0           | 3 (M1, M2, M3)       | 6      |
| Medium (design)     | 2 (D2, D4)                    | 0           | 4 (D1, D3, D5, D6)   | 6      |
| Low (polish)        | 3 (L4, L5, L6)                | 0           | 4 (L1, L2, L3, L7)   | 7      |
| New (F2.6)          | 1 (N2)                        | 0           | 1 (N1)               | 2      |
| **Total**           | **10**                        | **0**       | **16**               | **26** |

**Pre-publish gate for v1.0.0:** all 10 remaining open items (excluding deferred H5) must move to "In Progress" or "Resolved" before v1.0.0 publishes to npm. See [IMPLEMENTATION-PLAN.md §10.4 and §10.5](../IMPLEMENTATION-PLAN.md). The framework will publish at v0.1.0 (this round) with the remaining gates documented as "known limitations" in CHANGELOG.md, then ship v0.2.0 once Round 2 closes them.

**Recently resolved (in chronological order):**

- M1, M2, M3 (test debt) — F2.5, commit `4cbe189`
- H1, H2, H3, H4 (observability + scaling) — F2.6, commit `005c332`
- D3 (schema upcaster mechanism) — F3, commit `b1803cf`
- D1 (shared topic-matcher), D5 (SubscribeOptions validation), D6 (`>` in spec), N1 (make_interval), L1 (CHANGELOG), L2 (SECURITY.md), L3 (per-package READMEs), L7 (try/finally in examples) — F4 Round 1, this commit

## New tech debt discovered during F2.6

### N1: Outbox `markFailed` uses string concatenation for interval

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`packages/postgres/src/outbox.ts`](packages/postgres/src/outbox.ts)

**Resolution.** Switched to `make_interval(secs => $3::float8 / 1000.0)`. Behavior is identical to the prior `($3::int || ' milliseconds')::interval` form. The new form is type-safe, reads as a parameterized expression, and removes the future-contributor footgun.

### N2: Advisory-lock leader election not exercised in tests

**Status:** Open (Medium, folded into M4)
**Affected:** [`packages/postgres/src/outbox-scanner.ts`](packages/postgres/src/outbox-scanner.ts)

**Problem.** The H4 fix added `pool` + `lockKey` parameters for advisory-lock-based leader election but no test races two scanners and asserts only one publishes.

**Resolution.** Add a Postgres-only test that starts two scanners with the same lock key, captures publishes from each, asserts no duplicates. Folded into M4 (fault-injection conformance) for now.
