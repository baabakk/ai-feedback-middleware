/**
 * Full-stack example: Postgres event store + projection store + outbox +
 * tracked artifacts + actionability decisions, Redis pub/sub bus,
 * middleware pipeline, transactional outbox scanner (v2.1).
 *
 * Demonstrates:
 * - Composing all framework layers
 * - captureArtifact + recordReaction lifecycle
 * - Sync projection updated in capture transaction
 * - Async subscriber reading from the bus
 * - Outbox scanner draining outbox to bus with retry
 * - Middleware (logging, retry) wrapping bus publishes
 * - Actionability rule: 3 regenerated events on same task in 1 minute
 *   crystallize as `actionable_negative` on the content axis.
 *
 * Run:
 *   DATABASE_URL=postgres://user:pass@host:5432/feedback \
 *   REDIS_URL=redis://localhost:6379 \
 *     pnpm --filter postgres-redis start
 */
import pg from "pg";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  topicsFor,
  loggingMiddleware,
  retryMiddleware,
  type CapturedEvaluatedReactionEvent,
  type FeedbackEvent,
  type ProjectionBuilder,
} from "@ai-feedback-middleware/core";
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  createPostgresOutbox,
  createPostgresActionabilityRulesStore,
  createPostgresTrackedArtifactsStore,
  createPostgresActionabilityDecisionsStore,
  startOutboxScanner,
  runMigrations,
} from "@ai-feedback-middleware/postgres";
import { createRedisPubSubEventBus } from "@ai-feedback-middleware/redis-pubsub";

const { Pool } = pg;

type Counter = { count: number };

const writingSamples: ProjectionBuilder<Counter> = {
  name: "writing_samples",
  mode: "sync",
  applies: (e) =>
    e.event_kind === "reaction" && e.action === "approved" && e.artifact_type === "draft_email",
  apply: (_e, current) => ({ count: (current?.count ?? 0) + 1 }),
};

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const eventBus = createRedisPubSubEventBus({ connection: redisUrl });
  let unsubMetrics: (() => Promise<void>) | undefined;
  let stopScanner: (() => Promise<void>) | undefined;

  try {
    console.log("--- Running migrations ---");
    const m = await runMigrations(pool);
    console.log(`Applied: ${m.applied.join(", ")}`);

    // Seed an actionability rule: 3 regenerated reactions within 1 minute on
    // the content axis -> actionable_negative.
    const rules = createPostgresActionabilityRulesStore({ pool });
    await rules.upsert({
      rule_id: "demo_regenerated_to_content_actionable_negative",
      rule_version: "1",
      applies_when: { action: "regenerated" },
      axis: "content",
      threshold: 3,
      window_ms: 60_000,
      result_if_met: "actionable_negative",
      active: true,
      notes: "Demo rule for postgres-redis example",
    });

    // Compose framework
    const eventStore = createPostgresEventStore({ pool });
    const projectionStore = createPostgresProjectionStore({ pool });
    const outbox = createPostgresOutbox({ pool });
    const trackedArtifacts = createPostgresTrackedArtifactsStore({ pool });
    const actionabilityDecisions = createPostgresActionabilityDecisionsStore({ pool });

    const feedback = createFeedback({
      eventStore,
      projectionStore,
      trackedArtifacts,
      eventBus,
      outbox,
      actionabilityRules: rules,
      actionabilityDecisions,
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
      projections: [writingSamples],
      publishMiddleware: [
        loggingMiddleware({ pipelineName: "publish" }),
        retryMiddleware({ max: 3 }),
      ],
    });

    // Async subscriber: counts events by source (mock quality metrics).
    const sourceCounts = new Map<string, number>();
    unsubMetrics = await eventBus.subscribe("feedback.reaction.>", async (event: FeedbackEvent) => {
      if (event.event_kind !== "reaction") return;
      const key = event.source;
      sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    });

    stopScanner = startOutboxScanner({
      outbox,
      eventBus,
      intervalMs: 1000,
      onPublish: async (event, topics) => {
        await Promise.all(topics.map((t) => eventBus.publish(t, event)));
      },
    });

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    console.log("\n--- Capturing 5 lifecycles ---");
    const cap1 = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: "art-1",
      artifact_version: 1,
      producer: "demo-agent",
      task_type: "draft:email",
      payload: {},
      expires_at: future,
    });
    await feedback.recordReaction({ artifact_id: cap1.artifact_id, action: "approved" });

    // Trigger the rule: 3 regenerated reactions on the same artifact.
    const cap2 = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: "art-2",
      artifact_version: 1,
      producer: "demo-agent",
      task_type: "draft:email",
      payload: {},
      expires_at: future,
    });
    for (let i = 0; i < 3; i++) {
      await feedback.recordReaction({ artifact_id: cap2.artifact_id, action: "regenerated" });
    }

    const cap3 = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: "art-3",
      artifact_version: 1,
      producer: "demo-agent",
      task_type: "draft:email",
      payload: {},
      expires_at: future,
    });
    await feedback.recordReaction({
      artifact_id: cap3.artifact_id,
      action: "manually_edited",
      payload: { original: "long formal text", corrected: "Hi" },
    });

    console.log("\n--- Waiting 1.5s for outbox + bus delivery ---");
    await new Promise((r) => setTimeout(r, 1500));

    console.log("\n--- Outbox status ---");
    console.log(`Backlog: ${await outbox.backlogSize()}`);
    console.log(`Oldest unpublished age: ${await outbox.oldestUnpublishedAgeMs()} ms`);

    console.log("\n--- Reaction-source distribution (from async subscriber) ---");
    for (const [k, v] of sourceCounts) {
      console.log(`  ${k}: ${v}`);
    }

    console.log("\n--- Actionability decisions for art-2 ---");
    let decisionCount = 0;
    for await (const d of feedback.readActionableDecisions({ axis: "content" })) {
      if (d.artifact_id !== "art-2") continue;
      decisionCount += 1;
      console.log(
        `  decision_id=${d.decision_id} axis=${d.axis} inference=${d.inference} evidence=${d.evidence_event_ids.length} reactions`,
      );
    }
    console.log(`Total content-axis decisions on art-2: ${decisionCount}`);

    console.log("\n--- Reading reaction stream for art-2 ---");
    const reactions: CapturedEvaluatedReactionEvent[] = [];
    for await (const r of feedback.readReactions({ partition_key: "art-2" })) reactions.push(r);
    for (const r of reactions) {
      console.log(`  ${r.event_id} | action=${r.action} | content=${r.evaluations.content ?? "—"}`);
    }

    console.log("\n--- Topics for the latest event ---");
    if (reactions.length > 0) {
      for (const t of topicsFor(reactions[reactions.length - 1]!)) {
        console.log(`  ${t}`);
      }
    }
    console.log("\nDone.");
  } finally {
    if (unsubMetrics) await unsubMetrics().catch(() => {});
    if (stopScanner) await stopScanner().catch(() => {});
    await eventBus.close().catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
