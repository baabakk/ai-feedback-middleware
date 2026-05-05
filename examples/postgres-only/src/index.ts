/**
 * Postgres-backed example for @llm-feedback-middleware.
 *
 * Demonstrates:
 * - Composing the framework with Postgres adapters
 * - Running framework migrations
 * - Capture, sync projection, query, rebuild
 *
 * Run:
 *   DATABASE_URL=postgres://user:pass@host:5432/db pnpm --filter postgres-only start
 */
import pg from "pg";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  type ProjectionBuilder,
  type FeedbackEvent,
} from "@llm-feedback-middleware/core";
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  runMigrations,
} from "@llm-feedback-middleware/postgres";

const { Pool } = pg;

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
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required. Example:");
    console.error("  DATABASE_URL=postgres://user:pass@localhost:5432/feedback pnpm start");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  console.log("--- Running migrations ---");
  const migrations = await runMigrations(pool);
  console.log(`Applied: ${migrations.applied.join(", ")}`);

  const feedback = createFeedback({
    eventStore: createPostgresEventStore({ pool }),
    projectionStore: createPostgresProjectionStore({ pool }),
    actions: DEFAULT_ACTIONS,
    artifactTypes: [{ name: "draft" }, { name: "summary" }],
    projections: [approvalCountByProducer],
  });

  console.log("\n--- Capturing 3 events ---");
  await feedback.capture({
    action: "approve",
    artifact_type: "draft",
    artifact_id: "draft-001",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "email_draft:warm",
    payload: { artifact_hash: "sha256:aaa" },
  });
  await feedback.capture({
    action: "approve",
    artifact_type: "summary",
    artifact_id: "summary-001",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "morning_brief",
    payload: {},
  });
  await feedback.capture({
    action: "edit",
    artifact_type: "draft",
    artifact_id: "draft-002",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "email_draft:warm",
    payload: { original: "I hope this email finds you well.", corrected: "Hi." },
  });
  console.log("Captured 3 events");

  console.log("\n--- Reading partition stream for draft-001 ---");
  const events: FeedbackEvent[] = [];
  for await (const e of feedback.readStream("draft-001")) events.push(e);
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

  console.log("\n--- Rebuilding the same projection from the log ---");
  const rebuild = await feedback.rebuildProjection("approval_count_by_producer");
  console.log(
    `Rebuild processed ${rebuild.eventsProcessed} matching events in ${rebuild.durationMs}ms`,
  );
  const countsAfter = await feedback.queryProjection<ApprovalCount>(
    "approval_count_by_producer",
    undefined,
  );
  for (const c of countsAfter) {
    console.log(`  ${c.producer}: ${c.count} approvals (after rebuild)`);
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
