# Getting started

This page walks you from "I have an LLM-producing app" to "feedback events
are flowing through the framework" in five steps. Allow ~30 minutes the
first time.

## 1. Decide what you want to capture

The framework records events shaped like
`(actor, action, artifact, payload, time)`. You will be capturing things
like:

- A human approves a draft email the assistant produced.
- A human edits a draft and sends the edited version.
- The system silently sends a draft after no edit for N hours.
- A human regenerates an answer (negative implicit signal).

Before installing anything, write down two lists on paper:

- **Actions** you want to record. The framework ships with `approve`,
  `edit`, `reject`, `regenerate`, `expired`, `silent_accept`, and `disuse`.
  You can add more later via `ActionRegistry`.
- **Artifact types** you want to record. Examples: `draft`, `summary`,
  `email`, `brief`, `decision`, `recommendation`. Each artifact type gets
  its own retention policy.

If your two lists fit on a sticky note, you are ready.

## 2. Install

```bash
pnpm add @ai-feedback-middleware/core @ai-feedback-middleware/in-memory
```

Adapter packages are independent, so install only what you need. For a
real deployment you will likely also want:

```bash
pnpm add @ai-feedback-middleware/postgres @ai-feedback-middleware/redis-pubsub pg ioredis
```

## 3. Compose the framework

The framework is built around `createFeedback(options): FeedbackPort`.
Wire in an event store, a projection store, and your registries:

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
```

That is enough to capture and read events. Add a bus and outbox when you
need projections or async subscribers (next page).

## 4. Capture an event

```typescript
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

The framework:

1. Validates the input via the registered action's payload schema.
2. Classifies the event (deterministically) into source / polarity / inference.
3. Appends the event to the event store.
4. Updates registered sync projections.
5. Optionally enqueues for async dispatch via the bus + outbox.

## 5. Read it back

```typescript
for await (const event of feedback.readStream("draft-123")) {
  console.log(event.event_id, event.action, event.inference);
}
```

That is the round trip. Everything else in the docs is about scaling this
to real production: storage adapters, transactional outbox patterns,
inference rules, projections, middleware, and stream operators.

## Where to go next

- [Concepts: the 2x2 framework](./concepts/the-2x2-framework.md) - the
  classification model that drives everything downstream.
- [Concepts: event sourcing basics](./concepts/event-sourcing-basics.md) -
  why the event log is the source of truth.
- [Concepts: ports and adapters](./concepts/ports-and-adapters.md) - how
  storage, transport, and side-effects are isolated.
- [Adapters: Postgres setup](./adapters/postgres-setup.md) - the most
  common production storage adapter.
- [Cookbook: threshold crystallization](./cookbooks/threshold-crystallization.md) -
  promote an `observe` pattern to `blacklist` after N negative events.
