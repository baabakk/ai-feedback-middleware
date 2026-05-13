---
layout: home

hero:
  name: ai-feedback-middleware
  text: Composable performance feedback for AI agents
  tagline: |
    Plug-and-play, event-sourced middleware for capturing, interpreting,
    and operationalizing feedback to improve LLM and agent performance.
    Multi-axis polarity, locked action vocabulary, lifecycle worker for
    silent-feedback coverage, ports-and-adapters all the way down.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/baabakk/ai-feedback-middleware

features:
  - icon: 🎯
    title: Multi-axis polarity, not a single scalar
    details: |
      Every reaction scored independently on four axes — detection, content,
      timing, channel. No more collapsing "user disliked this" into one bit
      and losing the why. The four axes map directly to four remediation
      paths (trigger rules, prompts, scheduling, delivery routing).
  - icon: 📚
    title: 13 locked actions, past-tense
    details: |
      approved · manually_edited · rejected · regenerated · not_selected_from_list ·
      mute_triggered · silently_accepted · silently_rejected_expired ·
      internally_unobserved_externally_completed · manually_replaced ·
      corrected · cancelled · superseded_by. Consumers extend; the core
      vocabulary is locked so cross-consumer analytics work.
  - icon: ⏰
    title: Silent feedback is captured, not lost
    details: |
      Every governed artifact has a required expiresAt. The Lifecycle Worker
      fires silently_accepted or silently_rejected_expired on deadline per
      the artifact type's policy. No more "we never knew if the user agreed."
  - icon: 🧬
    title: Inline Layer 4 actionability inference
    details: |
      Threshold rules over recent reactions promote per-axis polarity from
      continue_to_observe to actionable_positive or actionable_negative.
      Runs in the same transaction as the triggering reaction. Tombstones
      filter direction-symmetrically.
  - icon: 🔌
    title: Provider-agnostic adapters
    details: |
      Postgres for production, in-memory for tests, Redis pub/sub bus, RxJS
      streams wrapper. Adapter conformance suite is the contract — write
      your own and it just works. SQLite shipping next.
  - icon: 🛡️
    title: Event-sourced + immutable
    details: |
      captured_artifacts and captured_evaluated_reactions are append-only.
      Tombstones (cancelled / corrected / superseded_by) reference earlier
      events; they never mutate. Full audit, perfect replay.
---

## 60 seconds

**1. Install:**

```bash
pnpm add @ai-feedback-middleware/core @ai-feedback-middleware/in-memory
```

**2. Compose at startup:**

```ts
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";

export const feedback = createFeedback({
  eventStore: createInMemoryEventStore(),
  projectionStore: createInMemoryProjectionStore(),
  trackedArtifacts: createInMemoryTrackedArtifactsStore(),
  actions: DEFAULT_ACTIONS,
  artifactTypes: [rejectByDefault("draft_email")],
});
```

**3. Capture an artifact when the agent produces something reviewable:**

```ts
const { artifact_id } = await feedback.captureArtifact({
  artifact_type: "draft_email",
  artifact_version: 1,
  producer: "secretary-agent",
  task_type: "outbound:warm_intro",
  payload: { recipient: "alice@example.com", body: "..." },
  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
});
```

**4. Record a reaction when the user acts:**

```ts
await feedback.recordReaction({
  artifact_id,
  action: "approved",
  payload: { actor_id: "babak" },
});
```

That's it. The framework writes the capture event, the reaction event with
per-axis evaluation embedded, optionally runs Layer 4 inference rules in
the same transaction, transitions the lifecycle row to its terminal state,
and publishes per-axis topics so downstream subscribers (prompt tuning,
labeling, alerting) can pick up what they care about.

## How it relates to other tools

| Tool | How `ai-feedback-middleware` relates |
|---|---|
| [Argilla](https://argilla.io/), [Label Studio](https://labelstud.io/) | Annotation queues for humans. Argilla's "Records pending annotation" map to our `tracked_artifacts` rows in `waiting` state. Use them as a queue UI on top of this framework. |
| [Humanloop](https://humanloop.com/), [LangSmith](https://smith.langchain.com/), [Langfuse](https://langfuse.com/) | LLM observability + offline eval. Their "Score" / "Feedback" rows map to our `captured_evaluated_reactions`. Subscribe to `feedback.reaction.*` and pipe events to whichever tool fits your stack. |
| [Helicone](https://helicone.ai/), [PromptLayer](https://promptlayer.com/) | Telemetry. Different concern — we trust and ignore them at the feedback boundary. |
| [Temporal](https://temporal.io/), [Inngest](https://inngest.com/) | Workflow orchestration. Different concern — use them around the framework, not inside. The Lifecycle Worker is narrow: deadline + policy → action emission. |

The framework is adjacent, not competitive. Typical adoption: this framework captures and evaluates; downstream subscribers ship events to your existing tools.

## What you get

- **`@ai-feedback-middleware/core`** — interfaces, classifier, ports, 13-action registry, schema upcasters
- **`@ai-feedback-middleware/in-memory`** — single-process testing adapters
- **`@ai-feedback-middleware/postgres`** — production adapters with 8 SQL migrations
- **`@ai-feedback-middleware/redis-pubsub`** — at-most-once pub/sub bus
- **`@ai-feedback-middleware/streams`** — RxJS wrapper for composable subscribers
- **`@ai-feedback-middleware/reference`** — reference projections + capture adapters
- **`@ai-feedback-middleware/adapter-conformance`** — write your own adapters with the same contract

## Status

**v0.3.0-alpha.0** — schema v2.1 lands. CI green on Node 20 + 22 against real Postgres 16 and Redis 7 via Docker service containers. 325 tests across 7 packages plus 12 runnable example apps. Not yet on npm (scope registration pending); install from the repo until then.

[Read the full positioning →](/why)
