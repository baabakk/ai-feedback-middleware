/**
 * Full-stack example: Postgres event store + projection store + outbox,
 * Redis pub/sub bus, middleware pipeline, transactional outbox scanner.
 *
 * Demonstrates:
 * - Composing all framework layers
 * - Sync projection (writing samples) updated in capture transaction
 * - Async subscriber (quality metrics) reading from the bus
 * - Outbox scanner draining outbox to bus with retry
 * - Middleware (logging, retry) wrapping bus publishes
 * - Inference rule: 3 regenerates on same task in 1 minute -> blacklist
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
  topicsFor,
  loggingMiddleware,
  retryMiddleware,
  type ProjectionBuilder,
  type FeedbackEvent,
} from "@llm-feedback-middleware/core";
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  createPostgresOutbox,
  createPostgresInferenceRulesStore,
  startOutboxScanner,
  runMigrations,
} from "@llm-feedback-middleware/postgres";
import { createRedisPubSubEventBus } from "@llm-feedback-middleware/redis-pubsub";

const { Pool } = pg;

type Counter = { count: number };

const writingSamples: ProjectionBuilder<Counter> = {
  name: "writing_samples",
  mode: "sync",
  applies: (e) => e.action === "approve" && e.artifact_type === "draft",
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

  console.log("--- Running migrations ---");
  const m = await runMigrations(pool);
  console.log(`Applied: ${m.applied.join(", ")}`);

  // Seed an inference rule: 3 regenerates within 1 minute -> blacklist
  const rules = createPostgresInferenceRulesStore({ pool });
  await rules.upsert({
    rule_id: "demo_regenerate_to_blacklist",
    applies_when: { action: "regenerate" },
    threshold: 3,
    window_ms: 60_000,
    result_if_met: "blacklist",
    active: true,
    notes: "Demo rule for postgres-redis example",
  });

  // Compose framework
  const eventStore = createPostgresEventStore({ pool });
  const projectionStore = createPostgresProjectionStore({ pool });
  const outbox = createPostgresOutbox({ pool });
  const eventBus = createRedisPubSubEventBus({ connection: redisUrl });

  const feedback = createFeedback({
    eventStore,
    projectionStore,
    eventBus,
    outbox,
    inferenceRules: rules,
    actions: DEFAULT_ACTIONS,
    artifactTypes: [{ name: "draft" }],
    projections: [writingSamples],
    publishMiddleware: [
      loggingMiddleware({ pipelineName: "publish" }),
      retryMiddleware({ max: 3 }),
    ],
  });

  // Async subscriber: counts events by inference (mock quality metrics).
  const inferenceCounts = new Map<string, number>();
  const unsubMetrics = eventBus.subscribe("feedback.inference.>", async (event: FeedbackEvent) => {
    const key = event.inference;
    inferenceCounts.set(key, (inferenceCounts.get(key) ?? 0) + 1);
  });

  // Outbox scanner — drains outbox to bus every 1s in this demo
  const stopScanner = startOutboxScanner({
    outbox,
    eventBus,
    intervalMs: 1000,
    onPublish: async (event, topics) => {
      await Promise.all(topics.map((t) => eventBus.publish(t, event)));
    },
  });

  console.log("\n--- Capturing 5 events ---");
  await feedback.capture({
    action: "approve",
    artifact_type: "draft",
    artifact_id: "art-1",
    artifact_version: 1,
    producer: "demo-agent",
    task_type: "draft:email",
    payload: {},
  });
  // Trigger the rule: 3 regenerates on the same partition.
  for (let i = 0; i < 3; i++) {
    await feedback.capture({
      action: "regenerate",
      artifact_type: "draft",
      artifact_id: "art-2",
      artifact_version: i + 1,
      producer: "demo-agent",
      task_type: "draft:email",
      payload: {},
    });
  }
  await feedback.capture({
    action: "edit",
    artifact_type: "draft",
    artifact_id: "art-3",
    artifact_version: 1,
    producer: "demo-agent",
    task_type: "draft:email",
    payload: { original: "long formal text", corrected: "Hi" },
  });

  // Wait for outbox scanner + bus delivery
  console.log("\n--- Waiting 1.5s for outbox + bus delivery ---");
  await new Promise((r) => setTimeout(r, 1500));

  console.log("\n--- Outbox status ---");
  console.log(`Backlog: ${await outbox.backlogSize()}`);
  console.log(`Oldest unpublished age: ${await outbox.oldestUnpublishedAgeMs()} ms`);

  console.log("\n--- Inference distribution (from async subscriber) ---");
  for (const [k, v] of inferenceCounts) {
    console.log(`  ${k}: ${v}`);
  }

  console.log("\n--- Reading partition stream for art-2 (the regenerate target) ---");
  const events: FeedbackEvent[] = [];
  for await (const e of feedback.readStream("art-2")) events.push(e);
  for (const e of events) {
    console.log(
      `  ${e.event_id} | ${e.action} | polarity=${e.polarity} | inference=${e.inference}`,
    );
  }
  // The 3rd regenerate should hit the threshold and be classified as blacklist.
  const blacklisted = events.filter((e) => e.inference === "blacklist");
  console.log(
    `\n  ${blacklisted.length} of ${events.length} regenerate events crossed the threshold`,
  );

  console.log("\n--- Topics published for the latest event ---");
  if (events.length > 0) {
    for (const t of topicsFor(events[events.length - 1]!)) {
      console.log(`  ${t}`);
    }
  }

  // Teardown
  await unsubMetrics();
  await stopScanner();
  await eventBus.close();
  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
