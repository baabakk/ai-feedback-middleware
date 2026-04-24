/**
 * Minimal Node.js example for @llm-feedback-middleware.
 *
 * Demonstrates:
 * - Composing the framework with in-memory adapters
 * - Capturing approve, edit, reject events
 * - A simple sync projection (approval count by producer)
 * - Reading raw event stream
 * - Querying projection state
 *
 * Run: pnpm --filter minimal-nodejs start
 */
import {
  createFeedback,
  DEFAULT_ACTIONS,
  type ProjectionBuilder,
  type FeedbackEvent,
} from "@llm-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
} from "@llm-feedback-middleware/in-memory";

type ApprovalCount = { producer: string; count: number };

const approvalCountByProducer: ProjectionBuilder<ApprovalCount> = {
  name: "approval_count_by_producer",
  mode: "sync",
  applies: (e) => e.action === "approve",
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
    actions: DEFAULT_ACTIONS,
    artifactTypes: [{ name: "draft" }, { name: "summary" }],
    projections: [approvalCountByProducer],
  });

  console.log("--- Capturing 3 events ---");

  const id1 = await feedback.capture({
    action: "approve",
    artifact_type: "draft",
    artifact_id: "draft-001",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "email_draft:warm",
    payload: { artifact_hash: "sha256:aaa" },
  });
  console.log(`Captured approve event: ${id1}`);

  const id2 = await feedback.capture({
    action: "approve",
    artifact_type: "summary",
    artifact_id: "summary-001",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "morning_brief",
    payload: {},
  });
  console.log(`Captured approve event: ${id2}`);

  const id3 = await feedback.capture({
    action: "edit",
    artifact_type: "draft",
    artifact_id: "draft-002",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "email_draft:warm",
    payload: {
      original: "I hope this email finds you well.",
      corrected: "Hi.",
    },
  });
  console.log(`Captured edit event: ${id3}`);

  console.log("\n--- Reading partition stream for draft-001 ---");
  const events: FeedbackEvent[] = [];
  for await (const e of feedback.readStream("draft-001")) {
    events.push(e);
  }
  for (const e of events) {
    console.log(
      `  ${e.event_id} | ${e.action} | polarity=${e.polarity} | inference=${e.inference}`,
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
