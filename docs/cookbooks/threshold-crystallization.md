# Cookbook: threshold crystallization

Promote an `observe` pattern to `blacklist` after N negative occurrences
within a sliding window. This is the canonical pattern that turns a
stream of feedback events into actionable rules.

## The scenario

Your AI agent occasionally regenerates responses for the same task. One
regeneration is a data point: maybe the user changed their mind, maybe
the response was bad. Three regenerations on the same task in one minute
is a pattern: the response is reliably wrong. The third regeneration
should be classified as `blacklist` so downstream consumers (in-context
retrieval, anti-pattern detection) treat it as a negative example.

## The rule

The framework's `InferenceRulesPort` lets you declare this:

```typescript
import { createPostgresInferenceRulesStore } from "@ai-feedback-middleware/postgres";

const rules = createPostgresInferenceRulesStore({ pool });

await rules.upsert({
  rule_id: "regenerate_threshold",
  applies_when: { action: "regenerate" },
  threshold: 3,
  window_ms: 60_000,
  result_if_met: "blacklist",
  active: true,
  notes: "3 regenerates on same partition in 1 minute -> blacklist",
});
```

The framework evaluates this rule on every `regenerate` event:

1. Count `regenerate` events in the same `partition_key` within the last
   60 seconds.
2. If count >= 3, classify the new event as `blacklist`.
3. Otherwise classify as `observe`.

## Wiring it into `createFeedback`

```typescript
const feedback = createFeedback({
  eventStore,
  projectionStore,
  inferenceRules: rules, // <- the rules store
  actions: DEFAULT_ACTIONS,
  artifactTypes: [{ name: "draft" }],
});
```

That is it. The classifier reads the rule on every capture; no separate
worker.

## Stream-based variant

The same pattern via the streams package, for consumers who want
operator-level control:

```typescript
import { toEventStream } from "@ai-feedback-middleware/streams";
import { filter, groupBy, mergeMap, bufferCount, tap } from "rxjs/operators";

const stream$ = toEventStream(eventBus, "feedback.action.regenerate");

stream$
  .pipe(
    filter((e) => e.partition_key.startsWith("draft-")),
    groupBy((e) => e.partition_key),
    mergeMap((group$) =>
      group$.pipe(
        bufferCount(3, 1), // sliding window of 3
        tap((events) => {
          console.log(`PROMOTED TO BLACKLIST: ${events[0].partition_key}`);
        }),
      ),
    ),
  )
  .subscribe();
```

This variant is useful when the rule is more complex than threshold +
window (e.g. "3 regenerates _and_ the artifact_type is `email`").

## Working example

The runnable
[`examples/threshold-crystallization/`](../../examples/threshold-crystallization/)
implements both variants end-to-end. It captures 5 regenerate events
across 2 (producer, task_type) groups, demonstrates that only the group
that crosses the threshold gets promoted, and prints the result.

## What to watch out for

- **Window size matters.** Too small and you miss the pattern. Too large
  and a stale incident pollutes today's classification. 60 seconds is a
  reasonable starting point for short-lived workflows; 24 hours fits a
  daily cadence.
- **Threshold tuning is empirical.** Start at 3, watch the false-positive
  rate, adjust. The framework's quality dashboard (or your own
  projection on `feedback_events`) is the right place to track this.
- **Blacklist is sticky.** Once an event is classified, the inference
  field does not change. Regenerating the inference label for old events
  requires a projection rebuild.
- **Per-partition vs. cross-partition.** The default rule scopes by
  `partition_key`. If you want "3 regenerates anywhere by this producer
  in 1 minute", switch to a custom predicate.

## Variations

- **Approve-rate threshold.** Promote a (producer, task_type) to
  `whitelist` once approval rate > 80% over 100 events. Use the
  `approvalRateProjection` from `@ai-feedback-middleware/reference`.
- **Anti-pattern detection.** Scan recent `blacklist` events for shared
  payload features (common phrases removed by edits) and synthesize a
  "do not do this" instruction for the next prompt.
- **Cooling.** Promote `blacklist` back to `observe` if no negative
  events arrive for K days. Implement as a scheduled rebuild that
  re-applies the rule with a recency filter.
