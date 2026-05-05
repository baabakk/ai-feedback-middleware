# llm-feedback-middleware

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/baabakk/llm-feedback-middleware/ci.yml?branch=main)](https://github.com/baabakk/llm-feedback-middleware/actions/workflows/ci.yml)
[![npm: core](https://img.shields.io/npm/v/@llm-feedback-middleware/core?label=%40llm-feedback-middleware%2Fcore)](https://www.npmjs.com/package/@llm-feedback-middleware/core)
[![Node](https://img.shields.io/node/v/@llm-feedback-middleware/core)](https://nodejs.org)

> **Status: 0.x.** APIs may change between minor releases. The classifier,
> event schema, and ports are stable; reference projections and capture
> adapters are still hardening.

A provider-agnostic framework for capturing, classifying, storing, and
dispatching feedback signals from humans and systems that review
AI-generated artifacts. Built on event sourcing with ports-and-adapters
isolation, an optional middleware pipeline for cross-cutting concerns,
and an optional RxJS stream wrapper for composable subscribers.

## Why this exists

Most production AI systems throw away most of the feedback they receive.
The systems that capture feedback at all capture it as a dead-end log.
This framework treats feedback as a first-class event stream:

- A **2x2 model** (explicit/implicit x positive/negative) plus a
  **whitelist/blacklist/observe inference dimension** that the
  deterministic classifier produces on every event.
- An **immutable event log** as the source of truth, queryable by
  partition or by filter.
- **Pluggable transport** (in-memory, Redis pub/sub, Kafka, NATS, cloud
  queues; bring your own).
- **Pluggable storage** (Postgres today, EventStoreDB or custom
  tomorrow).
- **Extension points** for consumer-specific actions, artifact types,
  and middleware.
- **No LLM in the feedback path.** Classification, inference, and
  edit-diff labeling are pure deterministic functions.

## Install

```bash
pnpm add @llm-feedback-middleware/core @llm-feedback-middleware/in-memory
# for production storage:
pnpm add @llm-feedback-middleware/postgres pg
# for cross-process dispatch:
pnpm add @llm-feedback-middleware/redis-pubsub ioredis
# optional, for stream operators:
pnpm add @llm-feedback-middleware/streams rxjs
# optional, for reference projections + capture adapters:
pnpm add @llm-feedback-middleware/reference
```

ESM only. Targets Node 18+.

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
  producer: "secretary-agent",
  task_type: "email_draft:warm",
  payload: { artifact_hash: "sha256:..." },
});

for await (const event of feedback.readStream("draft-123")) {
  console.log(event.event_id, event.action, event.inference);
}
```

For production wiring (Postgres + Redis + outbox + middleware) see
[`examples/postgres-redis/`](./examples/postgres-redis/) and the
[Postgres setup guide](./docs/adapters/postgres-setup.md).

## Packages

| Package                                        | Status | Purpose                                                                                                                         |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `@llm-feedback-middleware/core`                | F0     | Types, classifier, registry, ports, middleware, upcasters, edit-diff labeler                                                    |
| `@llm-feedback-middleware/in-memory`           | F0     | In-memory adapters for tests and small deployments                                                                              |
| `@llm-feedback-middleware/postgres`            | F1     | Postgres event store + projection store + outbox + dedupe + inference rules + migrations                                        |
| `@llm-feedback-middleware/redis-pubsub`        | F2     | Redis pub/sub event bus                                                                                                         |
| `@llm-feedback-middleware/streams`             | F3     | Optional RxJS-based stream wrapper (peer dep)                                                                                   |
| `@llm-feedback-middleware/reference`           | F3     | Reference projections (approval-rate, whitelist-examples, blacklist-phrases) and capture adapters (HTTP button, signed webhook) |
| `@llm-feedback-middleware/adapter-conformance` | F1+    | Conformance test suites for adapter implementers                                                                                |

Adapters are independent: install only the ones you use.

## Documentation

- [Getting started](./docs/getting-started.md)
- [Concepts: the 2x2 framework](./docs/concepts/the-2x2-framework.md)
- [Concepts: event sourcing basics](./docs/concepts/event-sourcing-basics.md)
- [Concepts: ports and adapters](./docs/concepts/ports-and-adapters.md)
- [Concepts: middleware pipeline](./docs/concepts/middleware-pipeline.md)
- [Adapters: Postgres setup](./docs/adapters/postgres-setup.md)
- [Adapters: choosing a bus](./docs/adapters/choosing-a-bus.md)
- [Adapters: writing a custom adapter](./docs/adapters/writing-a-custom-adapter.md)
- [Cookbook: threshold crystallization](./docs/cookbooks/threshold-crystallization.md)
- [Framework specification](../A02-Feedback-Middleware-Framework-Spec.md) - full design rationale
- [Article: Building a Learning Loop](../A02-Building-a-Learning-Loop-Every-LLM-Output-as-Training-Signal-v3.md) - Medium-style introduction

## Schemas

JSON Schema (Draft 7) and protobuf (`proto3`) artifacts for the canonical
`FeedbackEvent` live in [`schemas/`](./schemas/) for non-Node
consumers (Go, Rust, Python, Java).

## Examples

Runnable examples with end-to-end output:

- [`minimal-nodejs`](./examples/minimal-nodejs/) - in-memory only, no infra.
- [`postgres-only`](./examples/postgres-only/) - durable storage, sync projection, rebuild.
- [`postgres-redis`](./examples/postgres-redis/) - full stack with outbox + middleware + inference rule.
- [`threshold-crystallization`](./examples/threshold-crystallization/) - streams + groupBy + bufferCount.

## Conformance

If you write a new adapter, drop the suites from
[`@llm-feedback-middleware/adapter-conformance`](./packages/adapter-conformance/)
into your tests. If they pass, your adapter is interchangeable with the
in-memory and Postgres reference implementations.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow,
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) for community norms, and
[`CLA.md`](./CLA.md) for the contributor license. Security issues go
through [`SECURITY.md`](./SECURITY.md), not the public issue tracker.

## License

Apache License 2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

Copyright 2026 Babak Abbaschian.
