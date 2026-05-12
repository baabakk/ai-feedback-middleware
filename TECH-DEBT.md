# `ai-feedback-middleware` Tech Debt Tracker

**Last updated:** 2026-05-05 (F4 Round 2 closures — 17 of 17 actionable gates resolved; only H5 remains deferred)

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

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`packages/adapter-conformance/src/event-bus-conformance.ts`](packages/adapter-conformance/src/event-bus-conformance.ts), [`packages/in-memory/src/event-bus.ts`](packages/in-memory/src/event-bus.ts)

**Resolution.** Added the highest-value fault-injection scenarios:

1. New conformance test "a throwing subscriber does not block other subscribers on the same topic" exercises fault isolation across handlers.
2. The in-memory bus implementation was hardened to match the redis-pubsub adapter's behavior: a thrown handler is caught, surfaced via the new `onError({ phase: "handler", topic })` callback (default silent for backward compat), and dispatch continues to the remaining subscribers.
3. `InMemoryEventBusOptions.onError` was added so the in-memory adapter mirrors the redis-pubsub adapter's observability surface.
4. Plus the N2 advisory-lock leader-election Postgres test (see N2 below) which is the second fault-injection scenario in §10.4's M4 list.

The remaining M4 scenarios (random-failure injection in publish, transactional rollback in projection store) require adapter cooperation (test hooks the adapter must opt into); they are deferred until a Kafka or Streams adapter ships and we know what hooks to standardize.

---

### M5: Bus conformance setTimeout flakiness

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`packages/adapter-conformance/src/poll.ts`](packages/adapter-conformance/src/poll.ts), [`packages/adapter-conformance/src/event-bus-conformance.ts`](packages/adapter-conformance/src/event-bus-conformance.ts)

**Resolution.** Shipped `waitUntil(predicate, { timeoutMs, intervalMs })` in `poll.ts` and rewrote every `setTimeout` wait in `event-bus-conformance.ts` to use it. The suite's `deliveryWaitMs` option became `deliveryTimeoutMs` (default 1500ms) — a budget rather than a hard wait. Tests poll the predicate every 10ms and exit as soon as it passes. The new `waitUntil` is also exported from `@ai-feedback-middleware/adapter-conformance` for adapter authors to use in their own tests (e.g. the new outbox-scanner-leader test uses it). The redis-pubsub conformance test was updated to pass `deliveryTimeoutMs: 2000`.

---

### M6: No automated regression for core ↔ adapter typecheck linkage

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`.github/workflows/linkage.yml`](.github/workflows/linkage.yml)

**Resolution.** New CI workflow `linkage.yml` that packs every framework package into a `.tgz`, installs them into a scratch consumer directory via `npm install`, and runs a smoke script that imports `core` + `in-memory` from the packed artifacts and round-trips one event. This catches drift between the workspace-source typecheck (which adapters get via symlink during dev) and the actual published surface (`tsup` config gaps, missing `package.json#exports`, dropped types) that only matter post-publish. Run on every PR + push to main alongside the existing CI.

---

## Medium severity (design corners)

### D1: Bus pattern matcher duplicated

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`packages/core/src/topic-matcher.ts`](packages/core/src/topic-matcher.ts), [`packages/in-memory/src/event-bus.ts`](packages/in-memory/src/event-bus.ts), [`packages/redis-pubsub/src/event-bus.ts`](packages/redis-pubsub/src/event-bus.ts)

**Resolution.** Shipped `matchesTopic` in core as the single source of truth for the framework's `*` (single-segment) and `>` (NATS-style tail, one-or-more remaining) wildcard semantics. `#` is accepted as a synonym for `>`. Both bus adapters import and call the shared function. 14 tests in [`packages/core/tests/topic-matcher.test.ts`](packages/core/tests/topic-matcher.test.ts) cover exact match, single-segment `*`, tail `>`, `#` synonym, combined wildcards, and the partial-segment-not-supported case.

**Behavior change.** The previous in-memory matcher returned true for `>` even when there were no remaining segments to match (so `feedback.>` matched `feedback`). The shared matcher follows the spec and NATS convention: `>` requires at least one remaining segment. None of the framework's canonical topics fall foul of this since they all have at least two segments after the leading `feedback`.

---

### D2: `runMigrations` runs all SQL files every time

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`packages/postgres/migrations/000-feedback-migrations.sql`](packages/postgres/migrations/000-feedback-migrations.sql) (new), [`packages/postgres/src/migrate.ts`](packages/postgres/src/migrate.ts)

**Resolution.** Implemented option (1) — `feedback_migrations(filename, applied_at)` tracking table. Migration `000-feedback-migrations.sql` runs unconditionally to bootstrap the tracker (idempotent via `CREATE TABLE IF NOT EXISTS`); subsequent files are applied only if not already in the tracker. The runner now returns `{ applied: string[], skipped: string[] }` so consumers can see what was new vs. what was a no-op. The doc string still recommends Knex / node-pg-migrate / Flyway for production migration management of consumer-side migrations; `runMigrations` is now safer than before but is still bootstrap-only by design.

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

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`packages/in-memory/src/event-store.ts`](packages/in-memory/src/event-store.ts), [`packages/in-memory/tests/event-store.test.ts`](packages/in-memory/tests/event-store.test.ts)

**Resolution.** Added `InMemoryEventStoreOptions.maxEvents?: number` ring-buffer cap. When set, the oldest events are evicted in append-order (also during `appendBatch` and on a seed that exceeds the cap). The new option is unbounded by default to preserve backward compat. Construction throws on a non-positive integer to fail loud rather than silent. 5 new tests cover eviction, seed trimming, batch eviction, validation, and unbounded default. The JSDoc on the option flags the eviction policy as breaking the event-sourcing replay contract — for any production workload that relies on replay, use the Postgres adapter.

---

### D5: SubscribeOptions.deliveryMode and fromPosition ignored

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`packages/core/src/ports/event-bus-port.ts`](packages/core/src/ports/event-bus-port.ts), [`packages/in-memory/src/event-bus.ts`](packages/in-memory/src/event-bus.ts), [`packages/redis-pubsub/src/event-bus.ts`](packages/redis-pubsub/src/event-bus.ts)

**Resolution.** Implemented option (2) — loud failure. Shipped `SubscribeCapabilities` interface + `assertSupportedSubscribeOptions(options, capabilities)` helper in core. Each adapter declares the `deliveryMode` and `fromPosition` values it supports; `subscribe()` throws a descriptive error when the consumer asks for something the adapter cannot honor. Both reference adapters declare `at-most-once` + `latest` only (the actual semantics of in-memory and Redis pub/sub). 5 tests in [`packages/in-memory/tests/subscribe-options.test.ts`](packages/in-memory/tests/subscribe-options.test.ts) verify rejection messages and accepted defaults.

---

### D6: `>` wildcard not in framework spec

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`A02-Feedback-Middleware-Framework-Spec.md`](../A02-Feedback-Middleware-Framework-Spec.md) §9.2.1

**Resolution.** Added §9.2.1 "Wildcards" to the framework spec covering both `*` (single-segment) and `>` (NATS-style tail, one-or-more remaining) with worked examples. The new section also points adapter implementers at the shared `matchesTopic` source of truth in `@ai-feedback-middleware/core` and explains the per-adapter pattern of subscribing at the broadest transport-level match plus re-filtering on receive.

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

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`scripts/check-size.mjs`](scripts/check-size.mjs), [`package.json`](package.json), [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

**Resolution.** Shipped a dependency-free `scripts/check-size.mjs` script that prints per-package `dist/index.js` sizes against a budget table baked into the script. Wired into `pnpm size:check` and the CI workflow's Node 22 matrix entry. Initial baselines (with ~10-20% headroom): core 39.06 KB, in-memory 11.72 KB, postgres 24.41 KB, redis-pubsub 9.77 KB, streams 4.88 KB, reference 7.81 KB, adapter-conformance 34.18 KB. All packages comfortably under budget at v0.2.0; current actuals fit within 60-95% of budget across the matrix. The script's docstring describes the bump procedure (refresh dist, read actuals, bump to ~110-120% of actual, note the reason).

---

### L5: Node version matrix

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

**Resolution.** CI now matrixes against Node 18, 20, and 22. Lint, format-check, dependency-cruiser, and service-container integration tests run on Node 22 only (no point multiplying CI minutes for non-Node-specific things). Typecheck, in-memory + core + streams + reference unit tests, and full builds run on every Node version, validating the engines field's `>= 18` claim end-to-end.

---

### L6: No example for `withTransaction` from a consumer's perspective

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`examples/transactional-side-effect/`](examples/transactional-side-effect/) (new)

**Resolution.** Shipped `examples/transactional-side-effect/` demonstrating `eventStore.withTransaction((tx) => { append(event, tx); customAuditInsert(tx); })`. The example creates a consumer-owned `audit_log` table, captures one event that succeeds (both writes commit), and one event whose audit insert deliberately fails (the entire transaction rolls back — neither the audit row nor the framework event is durable). Verifies atomic commit semantics by reading both tables back at the end.

---

### L7: Examples don't shut down cleanly on capture errors

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`examples/postgres-redis/src/index.ts`](examples/postgres-redis/src/index.ts), [`examples/postgres-only/src/index.ts`](examples/postgres-only/src/index.ts)

**Resolution.** Both examples now wrap their main flow in `try { ... } finally { ... }`. The Postgres pool, Redis bus, outbox scanner, and metrics subscription all release on a thrown capture. The cleanup path itself uses `.catch(() => {})` per resource so a failing teardown does not mask the original error.

---

## Summary

| Severity            | Open                          | In Progress | Resolved                       | Total  |
| ------------------- | ----------------------------- | ----------- | ------------------------------ | ------ |
| High                | 1 (H5, deferred to Kafka/SQS) | 0           | 4 (H1, H2, H3, H4)             | 5      |
| Medium (test rigor) | 0                             | 0           | 6 (M1, M2, M3, M4, M5, M6)     | 6      |
| Medium (design)     | 0                             | 0           | 6 (D1, D2, D3, D4, D5, D6)     | 6      |
| Low (polish)        | 0                             | 0           | 7 (L1, L2, L3, L4, L5, L6, L7) | 7      |
| New (F2.6)          | 0                             | 0           | 2 (N1, N2)                     | 2      |
| **Total**           | **1 (deferred)**              | **0**       | **25**                         | **26** |

**Pre-publish gate for v1.0.0:** all 25 actionable items resolved as of F4 Round 2. The remaining open item (H5) is deferred until a Kafka or Streams adapter ships — it only affects at-least-once buses, and the current Redis pub/sub default is at-most-once and unaffected. The framework can publish at v1.0.0 once §10.5's CI/smoke/external-review checks pass.

**Recently resolved (in chronological order):**

- M1, M2, M3 (test debt) — F2.5, commit `4cbe189`
- H1, H2, H3, H4 (observability + scaling) — F2.6, commit `005c332`
- D3 (schema upcaster mechanism) — F3, commit `b1803cf`
- D1 (shared topic-matcher), D5 (SubscribeOptions validation), D6 (`>` in spec), N1 (make_interval), L1 (CHANGELOG), L2 (SECURITY.md), L3 (per-package READMEs), L7 (try/finally in examples) — F4 Round 1, commit `1d5d923`
- D2 (migration tracker), D4 (in-memory eviction), M4 (fault-injection conformance), M5 (waitUntil), M6 (linkage CI), L4 (size budgets), L5 (Node matrix), L6 (withTransaction example), N2 (advisory-lock test) — F4 Round 2, this commit

## New tech debt discovered during F2.6

### N1: Outbox `markFailed` uses string concatenation for interval

**Status:** ✅ Resolved 2026-05-05 (F4 Round 1)
**Affected:** [`packages/postgres/src/outbox.ts`](packages/postgres/src/outbox.ts)

**Resolution.** Switched to `make_interval(secs => $3::float8 / 1000.0)`. Behavior is identical to the prior `($3::int || ' milliseconds')::interval` form. The new form is type-safe, reads as a parameterized expression, and removes the future-contributor footgun.

### N2: Advisory-lock leader election not exercised in tests

**Status:** ✅ Resolved 2026-05-05 (F4 Round 2)
**Affected:** [`packages/postgres/tests/outbox-scanner-leader.test.ts`](packages/postgres/tests/outbox-scanner-leader.test.ts) (new)

**Resolution.** Added `outbox-scanner-leader.test.ts`: starts two scanners with the same `lockKey` against the same Postgres outbox, watches each scanner's publishes via per-instance counting buses, and asserts (a) every event is published exactly once across the union of both scanners, and (b) the total number of publishes equals the number of enqueued events. Gated on `FEEDBACK_TEST_DATABASE_URL` so it only runs in CI's Postgres-service-container matrix entry.
