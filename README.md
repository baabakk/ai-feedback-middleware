# llm-feedback-middleware

> **Status: Early development.** v0.x. APIs may change. Not yet published to npm.

A provider-agnostic framework for capturing, classifying, storing, and dispatching feedback signals from humans and systems that review AI-generated artifacts. Built on event sourcing with ports-and-adapters isolation.

## What it does

Most production AI systems throw away most of the feedback they're getting. The ones that capture feedback at all capture it as a dead-end log. This framework treats feedback as a first-class event stream:

- **2×2 model**: explicit/implicit × positive/negative, with whitelist/blacklist/observe inference
- **Immutable event log** as source of truth
- **Deterministic classification** (no LLM in the feedback path)
- **Pluggable transport** (in-memory, Redis pub/sub, Kafka, NATS, cloud queues)
- **Pluggable storage** (Postgres today, EventStoreDB or custom tomorrow)
- **Extension points** for consumer-specific actions and artifact types

## Quickstart

```typescript
import { createFeedback, DEFAULT_ACTIONS } from "@llm-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
} from "@llm-feedback-middleware/in-memory";

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
  producer: "my-llm-agent",
  task_type: "email_draft",
  payload: { artifact_hash: "sha256:..." },
});
```

## Packages

| Package                                        | Status | Purpose                                            |
| ---------------------------------------------- | ------ | -------------------------------------------------- |
| `@llm-feedback-middleware/core`                | F0     | Types, classifier, registry, ports                 |
| `@llm-feedback-middleware/in-memory`           | F0     | In-memory adapters for tests and small deployments |
| `@llm-feedback-middleware/postgres`            | F1     | Postgres event store + projection store + outbox   |
| `@llm-feedback-middleware/redis-pubsub`        | F2     | Redis pub/sub event bus                            |
| `@llm-feedback-middleware/streams`             | F3     | Optional RxJS-based stream wrapper                 |
| `@llm-feedback-middleware/reference`           | F3     | Reference projections and capture adapters         |
| `@llm-feedback-middleware/adapter-conformance` | F1+    | Conformance test suites for adapter implementers   |

## Documentation

- [Specification](../A02-Feedback-Middleware-Framework-Spec.md) — full design
- [Implementation Plan](../IMPLEMENTATION-PLAN.md) — phase-by-phase roadmap
- [Article](../A02-Building-a-Learning-Loop-Every-LLM-Output-as-Training-Signal-v3.md) — Medium-style introduction

## License

Apache License 2.0. See [LICENSE](./LICENSE).

Copyright 2026 Babak Abbaschian.
