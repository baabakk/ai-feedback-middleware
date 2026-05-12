# regenerate-burst-tuning

The Layer 4 punchline. Shows how the framework turns repeated per-event signals into a crystallized per-axis "this needs attention" decision that downstream consumers can act on.

## Problem

A single "regenerate" click is mildly informative — the user thought the trigger was right (`detection: positive`) but didn't like this particular version (`content: negative`). Three in a row on the same (producer, task_type) is much stronger signal: **the prompt or context for this task is wrong, not just one unlucky generation**. You want that escalation captured as a structured fact you can subscribe to, query, and feed into a prompt-tuning queue / labeling dataset / on-call alert.

## Solution

Register an `actionability_rules` row:

```ts
await rules.upsert({
  rule_id: "regenerate_burst_content_actionable_negative",
  rule_version: "1",
  applies_when: { action: "regenerated" },
  axis: "content",
  threshold: 3,
  window_ms: 60_000,
  result_if_met: "actionable_negative",
  active: true,
});
```

Layer 4 runs **inline inside `recordReaction()`**. When the third regenerate lands, the rule fires and the framework writes an `ActionabilityDecision` row in the same transaction as the reaction event. Downstream subscribers see `feedback.inference.content.actionable_negative` on the bus, query the decision, take action.

## Run

```bash
pnpm --filter regenerate-burst-tuning start
```

## What it shows

- `ActionabilityRulesPort.upsert` to seed a rule.
- Inline Layer 4: decision written in the same transaction as the triggering reaction.
- `feedback.readActionableDecisions({ axis, inference })` filtered read.
- Direction-symmetric tombstone filtering (if you `cancelArtifact` one of the regenerates, it won't count toward the threshold — go ahead and try it).

## Adapt it

| Pattern                                                                   | Rule shape                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| "5 manual edits in a week → content needs attention"                      | `applies_when.action = "manually_edited"`, `axis = "content"`, `threshold = 5`, `window_ms = 7 * 24 * 60 * 60 * 1000` |
| "3 `mute_triggered` on a notification channel → channel is wrong"         | `applies_when.action = "mute_triggered"`, `axis = "channel"`, `threshold = 3`                                         |
| "10 `silently_accepted` in a row → trust this (producer, task_type) more" | `applies_when.action = "silently_accepted"`, `axis = "content"`, `result_if_met = "actionable_positive"`              |

The four axes (`detection` / `content` / `timing` / `channel`) are the levers — each one corresponds to a different remediation: detection → review the trigger rules, content → review the prompt, timing → review scheduling, channel → review delivery routing.

## Subscribing on the bus

In a real deployment you'd subscribe to the per-axis topic rather than polling `readActionableDecisions`:

```ts
await eventBus.subscribe(
  "feedback.inference.content.actionable_negative.draft_email",
  async (decision) => {
    await promptTuningQueue.enqueue({
      rule: decision.rule_id,
      evidence: decision.evidence_event_ids,
    });
  },
);
```

The topic naming convention is `feedback.inference.<axis>.<inference>.<artifact_type>` (last segment optional). See [`../../docs/concepts/`](../../docs/concepts/) for the full topic taxonomy.
