# Why this framework exists

## The problem you have today

Any AI-driven system that produces artifacts for humans to review — drafts, classifications, summaries, recommendations, transcriptions, retrieval results — accumulates implicit and explicit feedback every time those artifacts move through the user's hands. Every approval, manual edit, rejection, silent acceptance, deadline expiry, manual replacement is a learning signal.

**Most production systems throw these signals away,** or capture them into dead-end analytics tables with no framework for interpretation.

The few that do capture feedback typically share the same flaws:

- **Outcomes land in a single opinion-loaded table** with no separation between *what happened* and *what we think it means*. The shape of an `approve` row and a `reject` row in the same table forces you to flatten very different events into one schema.
- **Polarity is encoded as a single scalar** (positive/negative) that conflates four orthogonal axes: was the trigger right? was the content good? was the timing right? was the channel right? Each has a different remediation path; collapsing them is lossy.
- **Implicit signals are missed entirely** because the framework has no way to detect the *absence* of a reaction. Silence after a draft is sent, the user doing the task externally, muting the trigger — all valuable signals, all invisible.
- **Cancellation, correction, supersession mutate the original event row,** breaking immutability. Then your audit log and your "current state" disagree.
- **Classification logic is hardcoded per feature,** never crystallizing into reusable rules. "3 regenerates means the prompt is wrong" lives as a console.log somewhere, not as a queryable fact.

## What this framework provides

### Multi-axis evaluation

Every reaction is scored along four independent axes — `detection` / `content` / `timing` / `channel`. Each axis is binary (`positive` / `negative` / omitted) — no neutral, no fuzzy gradients. Severity is computed downstream from payload (diff size, frequency, time-to-act). The capture layer surfaces *facts*; the inference layer ranks.

The four axes map directly to four remediation paths:

| Axis | If negative, you investigate |
|---|---|
| `detection` | Trigger rules / classifier — did this case even warrant a response? |
| `content` | Prompts / generation logic |
| `timing` | Scheduling / cadence |
| `channel` | Delivery routing |

### Per-axis actionability inference

Layer 4 reads recent reactions and applies threshold rules. For each (artifact, axis) it emits one of `actionable_positive` / `actionable_negative` / `continue_to_observe`. Decisions land in an append-only table; old decisions remain as historical fact when new ones arrive.

This runs **inline** in the same transaction as `recordReaction` by default — no async eventual consistency. Promotable to async without changing other layers.

### Lifecycle anchor with coverage net

Every captured artifact has a **required** `expiresAt`. A polling Lifecycle Worker with lease-based leader election fires:

- `silently_accepted` (under `accepted_by_default` policy) — silence is endorsement
- `silently_rejected_expired` (under `rejected_by_default` policy) — silence is rejection

Three of the framework's actions — and the absence of any signal at all — would otherwise be undetectable. The worker is the framework's coverage commitment for implicit feedback.

### Immutable event log + tombstone pattern

`captured_artifacts` and `captured_evaluated_reactions` are append-only. Cancellation, correction, supersession are appended events that the inference layer filters at judgment time. Original facts never mutate.

Tombstone filtering is **direction-symmetric**: a cancelled artifact whose events were trending toward `actionable_positive` is excluded just as completely as one trending toward `actionable_negative`.

### Pluggable transport and storage

Adapters for Postgres, in-memory, SQLite (coming soon). Bus adapters for Redis pub/sub. All adapters pass a shared conformance suite — write your own and it just works.

## Design decisions you can quote in your PR review

- **Why binary per axis, not graded?** Severity, confidence, and mildness are computed downstream from payload (diff size, frequency, time-to-act). Trying to encode mildness at capture time conflates capture and inference layers, and makes the storage schema arbitrarily wide.
- **Why polarity as a vector, not a scalar?** A single `polarity: negative` answers four questions at once. The four questions have different remediation paths; collapsing them forces consumers to pick the dominant cause and ignore the others (lossy), or re-derive per-axis polarity from action + payload (every consumer reimplements). The vector form lets consumers ask "show me events where the *content* axis is negative regardless of timing or channel" — the actual analytical question for prompt-tuning workflows. The scalar form cannot answer this.
- **Why `expirationPolicy` is required, not inheritable?** Inheritance or a global default would let consumers ignore the question. That is exactly the failure mode that produces incoherent implicit-feedback data downstream. Forcing the choice at registration time forces the consumer to make it consciously. The `acceptByDefault` / `rejectByDefault` helpers make it ergonomic without removing the requirement.
- **Why tombstones, not delete?** Append-only means a delete is itself a fact you might want to query later ("when did we cancel this?"). Tombstones reference earlier events; the inference layer filters at judgment time. Old `actionability_decisions` rows that were computed before a tombstone arrived stay as they are.
- **Why no LLM in the feedback path?** Layer 3 (Reaction Evaluation) and Layer 4 (Actionable Result Inference) are strictly pure deterministic functions. Hard architectural commitment, not a default that can be toggled. A consumer who wants LLM-driven analysis plugs it into Layer 5 (Projections) with explicit opt-in, prompt versioning, and replay/audit. Layers 0–5 stay deterministic regardless.

## What this framework is NOT

- **Not a workflow engine.** Use Temporal / Inngest / Trigger.dev / Camunda for that. The Lifecycle Worker is narrow: deadline + policy → action emission.
- **Not an analytics warehouse.** The event log is the source of truth, not a query lake. For long-tail analytics, ETL it out to ClickHouse / BigQuery / Snowflake.
- **Not a labeling tool.** Use Argilla / Label Studio / Prodigy for human-in-the-loop annotation. This framework subscribes to feedback events; it does not produce them via a UI.
- **Not an ML platform.** Layers 3 and 4 are deterministic. No model training, no fine-tuning, no inference service. Subscribe to `feedback.inference.<axis>.actionable_*` events and drive your own ML pipelines downstream.
- **Not the adaptation layer.** Layer 6 (Adaptation) is explicitly outside the framework. The framework gives you facts, evaluations, inferences, and projections. Whether you change your prompts, your routing, your timing — that is your decision and your code.

## Next steps

- [Get started in 60 seconds](/getting-started)
- [Walk through the concepts](/concepts/ports-and-adapters)
- [Browse 12 runnable examples](https://github.com/baabakk/ai-feedback-middleware/tree/main/examples) — usecase-driven, copyable
