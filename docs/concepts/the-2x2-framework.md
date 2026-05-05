# The 2x2 framework

Most production AI systems treat feedback as a flat log of approvals and
rejections. That throws away the most useful signals. The framework
reorganizes feedback along two axes plus an inference dimension.

## The two axes

|              | Positive                                    | Negative                                        |
| ------------ | ------------------------------------------- | ----------------------------------------------- |
| **Explicit** | "approve", thumbs-up                        | "reject", thumbs-down                           |
| **Implicit** | "silent_accept", `disuse` of an alternative | "regenerate", `disuse` of the produced artifact |

Each event lands in exactly one quadrant. Reading a quadrant in isolation
is informative on its own:

- **Explicit positive** is the gold standard. Use these for in-context
  examples or fine-tuning data.
- **Explicit negative** is the most actionable error signal: a human
  saw it and said no.
- **Implicit positive** is the silent endorsement. Often the largest
  bucket; people are too busy to thumbs-up things that work.
- **Implicit negative** is the leakage signal: silent regeneration,
  abandonment, ignoring an alternative.

If you only capture explicit feedback, you systematically underweight the
behavior of busy users. If you only capture implicit feedback, you cannot
distinguish "good but slow" from "bad and avoided." Both axes matter.

## The inference dimension

Every event also gets one of three inference labels:

- **`whitelist`** - this pattern should be promoted. Use as a positive
  example, lower the threshold to suggest it again.
- **`blacklist`** - this pattern should be avoided. Use as a negative
  example, raise the threshold or prune from candidates.
- **`observe`** - we are watching but not acting yet. Used for new
  patterns, ambiguous cases, or events below a threshold.

Inference is not the same as polarity. A single negative edit might still
land in `observe` because it is the first time we have seen this kind of
edit. After the threshold (default: 3 occurrences in a 60-second window)
the inference engine promotes the pattern to `blacklist`.

This separation matters because:

- One negative event is a data point. A pattern of negatives is a rule.
- Inference rules are configurable per-deployment via
  `InferenceRulesPort`, so you tune sensitivity without changing code.

## Why three labels and not just two?

A binary "good / bad" classification creates whiplash: every new pattern
flips between accepted and rejected as the small-sample-size data settles.
The middle `observe` state is where the framework keeps patterns until
they have enough evidence to commit. This is the single most important
design choice for keeping a learning loop stable.

## How polarity and inference interact

The classifier (deterministic, no LLM) produces both polarity and
inference for each captured event:

```
explicit + positive -> whitelist (immediately)
explicit + negative -> blacklist (immediately)
implicit + positive -> observe -> whitelist (after threshold)
implicit + negative -> observe -> blacklist (after threshold)
```

Explicit signals act on the first event because a human committed to the
judgment. Implicit signals require multiple consistent observations to
promote because any single one might be noise.

## What this enables

Once events are classified and inference-labeled, downstream systems can
do simple, defensible things:

- **In-context retrieval**: pull recent `whitelist` events of the same
  artifact type as positive examples in the next prompt.
- **Threshold crystallization**: promote `observe` patterns to `blacklist`
  after N negative occurrences (see the [cookbook](../cookbooks/threshold-crystallization.md)).
- **Anti-pattern detection**: scan `blacklist` events for shared payload
  features and synthesize a "do not do this" instruction.
- **Quality dashboards**: per-quadrant counts over time tell you whether
  the AI is getting better or worse.

None of these require an LLM in the loop. The framework's classifier and
inference engine are pure functions; the learning loop is observable and
reproducible.
