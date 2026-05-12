# `@ai-feedback-middleware/core`

The framework's pure-domain layer. Defines event types, registries, the
deterministic classifier, the inference engine, the projection engine, the
ports that adapters implement, the middleware pipeline, the schema upcaster,
and the deterministic edit-diff labeler.

This package has **zero infrastructure dependencies** (no `pg`, no `redis`,
no `fastify`, no I/O, no clock, no random). It can be used by tests, scripts,
serverless functions, and ahead-of-time-compiled binaries without dragging in
a database driver.

## Install

```bash
pnpm add @ai-feedback-middleware/core
# pick at least one adapter package for storage:
pnpm add @ai-feedback-middleware/in-memory   # tests, toy deployments
# or
pnpm add @ai-feedback-middleware/postgres
pnpm add @ai-feedback-middleware/redis-pubsub
```

The package is ESM-only and targets Node 18+.

## Public surface

### Domain types

- `FeedbackEvent` — the canonical event shape.
- `FeedbackEventSchema` — the Zod schema (source of truth for JSON-Schema and protobuf generation).
- `CaptureInput`, `EventFilter`, `Provenance`, `Source`, `Polarity`, `Inference`.

### Registries (consumer extension points)

- `ActionRegistry` + `FeedbackActionDefinition` — register custom actions.
- `ArtifactTypeRegistry` + `ArtifactTypeDefinition` + `RetentionPolicy` — register artifact types and retention policies.
- `DEFAULT_ACTIONS` — the seven canonical actions (`approve`, `edit`, `reject`, `regenerate`, `expired`, `silent_accept`, `disuse`).
- `Approve|Edit|Reject|Regenerate|Expired|SilentAccept|DisusePayloadSchema` — Zod payload schemas per action.

### Engines

- `classify(input, context)` — the deterministic classifier (no LLM, no I/O, no random).
- `evaluateRules(event, rules, context)` — the inference engine (threshold-based promotion to whitelist/blacklist).
- `ProjectionEngine` + `ProjectionBuilder<TState>` — generic projection runtime.

### Schema evolution

- `EventUpcaster` — interface for v(N) → v(N+1) upcasters.
- `validateUpcasterChain(upcasters, currentSchemaVersion)` — boot-time chain check.
- `upcastEvent(event, upcasters, currentSchemaVersion)` — pure single-event upcast.
- `upcastStream(source, upcasters, currentSchemaVersion)` — `AsyncIterable` wrapper.

### Edit-diff labeler

- `classifyEditDiff(original, edited): ChangeLabel[]` — deterministic labeler returning one or more of 21 atomic change labels (`reduce_length`, `add_warmth`, `remove_formality`, `change_greeting`, etc.). No LLM.

### Ports (the contracts adapters implement)

- `EventStorePort` + `Transaction`
- `ProjectionStorePort`
- `EventBusPort` + `SubscribeOptions` + `SubscribeCapabilities`
- `assertSupportedSubscribeOptions(options, capabilities)` — adapter helper that throws on unsupported options
- `DedupeStorePort`
- `MetricsPort` + `noopMetrics`
- `InferenceRulesPort` + `InferenceRule` + `RulePredicate`
- `OutboxPort` + `OutboxRow`
- `FeedbackPort` + `RebuildResult` + `Unsubscribe`

### Topic matcher

- `matchesTopic(pattern, topic)` — single source of truth for the framework's topic-pattern semantics (`*` single-segment wildcard, `>` tail wildcard, `#` synonym).
- `topicsFor(event)` — produce the canonical fan-out topic list for an event.

### Middleware pipeline

- `compose(...middlewares)` — wrap a `capture()`-style core handler.
- 8 batteries-included middlewares: `logging`, `validation`, `injectProvenance`, `metrics`, `retry`, `idempotency`, `correlationId`, plus their option types.

### Factory

- `createFeedback(options): FeedbackPort` — the single composition point. Wires the eventStore + projectionStore (+ optional bus/outbox/inferenceRules/upcasters/middleware) into a `FeedbackPort`.

## Quickstart

```typescript
import { createFeedback, DEFAULT_ACTIONS } from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
} from "@ai-feedback-middleware/in-memory";

const feedback = createFeedback({
  eventStore: createInMemoryEventStore(),
  projectionStore: createInMemoryProjectionStore(),
  actions: DEFAULT_ACTIONS,
  artifactTypes: [{ name: "draft" }],
});

await feedback.capture({
  action: "approve",
  artifact_type: "draft",
  artifact_id: "draft-123",
  artifact_version: 1,
  producer: "secretary-agent",
  task_type: "email_draft:warm",
  payload: { artifact_hash: "sha256:..." },
});
```

See `examples/postgres-only/` and `examples/postgres-redis/` for production-shaped wiring.

## Design invariants

- **Pure-domain.** Anything that cannot be tested without setting `process.env.NODE_ENV` belongs in an adapter, not here.
- **Deterministic.** Same input → same output. The classifier and the edit-diff labeler are unit-testable without fixtures, fakes, or mocks.
- **Adapter-agnostic.** No special-casing for any specific storage or bus.
- **Forward-compatible.** Schema evolves through upcasters, not breaking changes.

See [`A02-Feedback-Middleware-Framework-Spec.md`](../../../A02-Feedback-Middleware-Framework-Spec.md) for the full design rationale.

## License

Apache 2.0
