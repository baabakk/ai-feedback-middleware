/**
 * Minimal Node.js example for @ai-feedback-middleware (v2.1).
 *
 * Demonstrates:
 * - Composing the framework with in-memory adapters
 * - captureArtifact() opens a lifecycle; recordReaction() closes it
 * - A simple sync projection (approval count by producer)
 * - Reading captured artifacts and reactions
 * - Querying projection state
 *
 * Run: pnpm --filter minimal-nodejs start
 */
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  acceptByDefault,
  type CapturedEvaluatedReactionEvent,
  type ProjectionBuilder,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";

type ApprovalCount = { producer: string; count: number };

const approvalCountByProducer: ProjectionBuilder<ApprovalCount> = {
  name: "approval_count_by_producer",
  mode: "sync",
  applies: (e) => e.event_kind === "reaction" && e.action === "approved",
  keyFor: (e) => e.producer,
  apply: (event, current) => ({
    producer: event.producer,
    count: (current?.count ?? 0) + 1,
  }),
};

async function main(): Promise<void> {
  const feedback = createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    trackedArtifacts: createInMemoryTrackedArtifactsStore(),
    actions: DEFAULT_ACTIONS,
    artifactTypes: [
      rejectByDefault("draft_email"),
      acceptByDefault("morning_briefing"),
    ],
    projections: [approvalCountByProducer],
  });

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  console.log("--- Capturing 3 artifacts and 3 reactions ---");

  const cap1 = await feedback.captureArtifact({
    artifact_type: "draft_email",
    artifact_id: "draft-001",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "email_draft:warm",
    payload: { artifact_hash: "sha256:aaa" },
    expires_at: future,
  });
  await feedback.recordReaction({
    artifact_id: cap1.artifact_id,
    action: "approved",
    payload: { actor_id: "babak" },
  });
  console.log(`Captured + approved draft-001`);

  const cap2 = await feedback.captureArtifact({
    artifact_type: "morning_briefing",
    artifact_id: "summary-001",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "morning_brief",
    payload: {},
    expires_at: future,
  });
  await feedback.recordReaction({
    artifact_id: cap2.artifact_id,
    action: "approved",
  });
  console.log(`Captured + approved summary-001`);

  const cap3 = await feedback.captureArtifact({
    artifact_type: "draft_email",
    artifact_id: "draft-002",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "email_draft:warm",
    payload: {},
    expires_at: future,
  });
  await feedback.recordReaction({
    artifact_id: cap3.artifact_id,
    action: "manually_edited",
    payload: {
      original: "I hope this email finds you well.",
      corrected: "Hi.",
    },
  });
  console.log(`Captured + edited draft-002`);

  console.log("\n--- Reading reactions ---");
  const reactions: CapturedEvaluatedReactionEvent[] = [];
  for await (const r of feedback.readReactions()) {
    reactions.push(r);
  }
  for (const r of reactions) {
    const e = r.evaluations;
    console.log(
      `  ${r.event_id} | action=${r.action} | content=${e.content ?? "—"} | timing=${
        e.timing ?? "—"
      }`,
    );
  }

  console.log("\n--- Querying approval_count_by_producer projection ---");
  const counts = await feedback.queryProjection<ApprovalCount>(
    "approval_count_by_producer",
    undefined,
  );
  for (const c of counts) {
    console.log(`  ${c.producer}: ${c.count} approvals`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
