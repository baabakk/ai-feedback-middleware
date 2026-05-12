/**
 * regenerate-burst-tuning — Layer 4 (Actionable Result Inference) end to end.
 *
 * Scenario: the agent ships a draft. The user clicks "regenerate, try again"
 * three times in a row on the same partition (same task_type + producer).
 * A single regenerate is a soft negative on content ("trigger right, this
 * version wrong, try again"). Three in a minute is a hard negative — strong
 * enough to mark the entire (producer, task_type) as needing prompt tuning.
 *
 * The framework expresses this as an `actionability_rules` row:
 *   - applies_when.action = "regenerated"
 *   - axis = "content"
 *   - threshold = 3
 *   - window_ms = 60_000
 *   - result_if_met = "actionable_negative"
 *
 * When `recordReaction` fires, the framework runs the rule inline against
 * recent reactions, filters tombstoned artifacts, and writes a per-(artifact,
 * axis) decision into `actionability_decisions` in the same transaction.
 * Downstream consumers subscribe to `feedback.inference.content.actionable_negative`
 * to feed prompt-tuning queues, push to LangSmith/Humanloop, alert the team,
 * etc. This example reads the decisions directly via
 * `feedback.readActionableDecisions(...)`.
 */
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  type ActionabilityDecision,
  type ActionabilityRule,
  type ActionabilityRulesPort,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryActionabilityDecisionsStore,
  createInMemoryActionabilityRulesStore,
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";

async function seedRules(rules: ActionabilityRulesPort): Promise<void> {
  const rule: ActionabilityRule = {
    rule_id: "regenerate_burst_content_actionable_negative",
    rule_version: "1",
    applies_when: { action: "regenerated" },
    axis: "content",
    threshold: 3,
    window_ms: 60_000,
    result_if_met: "actionable_negative",
    active: true,
    notes:
      "3 regenerate reactions within 60s on the same partition → content axis is actionable_negative",
  };
  await rules.upsert(rule);
}

async function main(): Promise<void> {
  const rules = createInMemoryActionabilityRulesStore();
  await seedRules(rules);

  const decisionsStore = createInMemoryActionabilityDecisionsStore();
  const feedback = createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    trackedArtifacts: createInMemoryTrackedArtifactsStore(),
    actionabilityRules: rules,
    actionabilityDecisions: decisionsStore,
    actions: DEFAULT_ACTIONS,
    artifactTypes: [rejectByDefault("draft_email")],
  });

  const future = (): string => new Date(Date.now() + 60_000).toISOString();

  console.log("--- Scenario: user keeps clicking 'regenerate' on the same draft ---\n");
  console.log("  (Layer 4 groups decisions by artifact_id, so 3 'regenerated' reactions");
  console.log("   on the SAME draft cross the threshold for that draft's content axis)\n");

  const cap = await feedback.captureArtifact({
    artifact_type: "draft_email",
    artifact_id: "draft-cold-outreach",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "outbound:cold_outreach",
    payload: { subject: "Quick intro" },
    expires_at: future(),
  });
  console.log(`  captured  ${cap.artifact_id}\n`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const reaction = await feedback.recordReaction({
      artifact_id: cap.artifact_id,
      action: "regenerated",
      payload: {
        reason:
          attempt === 1
            ? "tone too formal"
            : attempt === 2
              ? "still off"
              : "give up; flag for human rewrite",
      },
    });
    console.log(
      `  reaction #${attempt}  ${reaction.event_id.slice(0, 16)}…  content=${reaction.evaluations.content ?? "—"}`,
    );
  }

  // Inline Layer 4 fires inside recordReaction. Read the decisions back:
  console.log("\n--- Actionability decisions (Layer 4 output) ---\n");
  const decisions: ActionabilityDecision[] = [];
  for await (const d of feedback.readActionableDecisions({
    axis: "content",
    inference: "actionable_negative",
  })) {
    decisions.push(d);
  }

  if (decisions.length === 0) {
    console.log(
      "  (no decisions — try increasing artifact count above the threshold of 3)",
    );
  }
  for (const d of decisions) {
    console.log(`  decision_id     : ${d.decision_id}`);
    console.log(`  rule            : ${d.rule_id} (v${d.rule_version})`);
    console.log(`  artifact        : ${d.artifact_id}`);
    console.log(`  axis            : ${d.axis}`);
    console.log(`  inference       : ${d.inference}`);
    console.log(`  evidence count  : ${d.evidence_event_ids.length} reaction events`);
    console.log(`  evidence ids    : ${d.evidence_event_ids.join(", ")}`);
    console.log();
  }

  console.log("Key takeaways:");
  console.log(
    "  • Layer 4 ran inline inside recordReaction — decision lands in the SAME transaction",
  );
  console.log(
    "    as the reaction event. No async eventual consistency to worry about.",
  );
  console.log(
    "  • Decisions land in a separate immutable table; the inference output is an event of",
  );
  console.log(
    "    its own kind, not a mutation on the original reactions.",
  );
  console.log(
    "  • Downstream consumers subscribe to feedback.inference.content.actionable_negative to",
  );
  console.log(
    "    feed prompt-tuning queues, LangSmith/Humanloop datasets, Slack alerts, etc.",
  );
  console.log(
    "  • Tombstones (cancelled / corrected / superseded_by) filter symmetrically: a cancelled",
  );
  console.log(
    "    artifact's reactions are excluded regardless of which direction they were trending.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
