/**
 * Postgres-backed example for @ai-feedback-middleware (v2.1).
 *
 * Demonstrates:
 * - Composing the framework with Postgres adapters
 * - Running framework migrations
 * - captureArtifact + recordReaction lifecycle
 * - Sync projection + projection rebuild
 *
 * Run:
 *   DATABASE_URL=postgres://user:pass@host:5432/db pnpm --filter postgres-only start
 */
import pg from "pg";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  acceptByDefault,
  type CapturedEvaluatedReactionEvent,
  type ProjectionBuilder,
} from "@ai-feedback-middleware/core";
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  createPostgresTrackedArtifactsStore,
  runMigrations,
} from "@ai-feedback-middleware/postgres";

const { Pool } = pg;

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
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required. Example:");
    console.error("  DATABASE_URL=postgres://user:pass@localhost:5432/feedback pnpm start");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  try {
    console.log("--- Running migrations ---");
    const migrations = await runMigrations(pool);
    console.log(`Applied: ${migrations.applied.join(", ")}`);

    const feedback = createFeedback({
      eventStore: createPostgresEventStore({ pool }),
      projectionStore: createPostgresProjectionStore({ pool }),
      trackedArtifacts: createPostgresTrackedArtifactsStore({ pool }),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email"), acceptByDefault("morning_briefing")],
      projections: [approvalCountByProducer],
    });

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    console.log("\n--- Capturing 3 artifacts and 3 reactions ---");
    const cap1 = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: "draft-001",
      artifact_version: 1,
      producer: "secretary-agent",
      task_type: "email_draft:warm",
      payload: { artifact_hash: "sha256:aaa" },
      expires_at: future,
    });
    await feedback.recordReaction({ artifact_id: cap1.artifact_id, action: "approved" });

    const cap2 = await feedback.captureArtifact({
      artifact_type: "morning_briefing",
      artifact_id: "summary-001",
      artifact_version: 1,
      producer: "secretary-agent",
      task_type: "morning_brief",
      payload: {},
      expires_at: future,
    });
    await feedback.recordReaction({ artifact_id: cap2.artifact_id, action: "approved" });

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
      payload: { original: "I hope this email finds you well.", corrected: "Hi." },
    });
    console.log("Captured 3 artifacts + reactions");

    console.log("\n--- Reading reactions ---");
    const reactions: CapturedEvaluatedReactionEvent[] = [];
    for await (const r of feedback.readReactions()) reactions.push(r);
    for (const r of reactions) {
      const e = r.evaluations;
      console.log(`  ${r.event_id} | action=${r.action} | content=${e.content ?? "—"}`);
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
    console.log("\nDone.");
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
