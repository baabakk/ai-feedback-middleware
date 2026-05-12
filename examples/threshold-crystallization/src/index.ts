/**
 * Threshold-crystallization example using @ai-feedback-middleware/streams (v2.1).
 *
 * Watches the bus for `regenerated` reactions and groups by (producer, task_type).
 * When 3 regenerated reactions accumulate for the same group, promotes the
 * task to a "negative-content" list (printed to stdout for the demo).
 *
 * This is the canonical use case for the streams package: stateful
 * across-event aggregation that's awkward in plain callbacks.
 *
 * Run: pnpm --filter threshold-crystallization start
 */
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryEventBus,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";
import {
  toEventStream,
  filter,
  groupBy,
  mergeMap,
  bufferCount,
  tap,
} from "@ai-feedback-middleware/streams";

async function main(): Promise<void> {
  const eventBus = createInMemoryEventBus();
  const feedback = createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    trackedArtifacts: createInMemoryTrackedArtifactsStore(),
    eventBus,
    actions: DEFAULT_ACTIONS,
    artifactTypes: [rejectByDefault("draft_email")],
  });

  // Subscriber: count regenerated reactions per (producer, task_type); fire when threshold met.
  const negativeContentTasks = new Set<string>();
  const subscription = toEventStream(eventBus, "feedback.reaction.>")
    .pipe(
      filter((e) => e.event_kind === "reaction" && e.action === "regenerated"),
      groupBy((e) => `${e.producer}::${e.task_type}`),
      mergeMap((group$) =>
        group$.pipe(
          bufferCount(3),
          tap((batch) => {
            const first = batch[0]!;
            const key = `${first.producer}::${first.task_type}`;
            negativeContentTasks.add(key);
            console.log(
              `\n  CRYSTALLIZED actionable_negative on content axis: ${key} ` +
                `(${batch.length} regenerated events: ${batch.map((e) => e.event_id).join(", ")})`,
            );
          }),
        ),
      ),
    )
    .subscribe();

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  console.log("--- Capturing 5 regenerated reactions: 3 on draft:email, 2 on draft:slack ---");
  const fire = async (artId: string, taskType: string): Promise<void> => {
    const cap = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: artId,
      artifact_version: 1,
      producer: "demo-agent",
      task_type: taskType,
      payload: {},
      expires_at: future,
    });
    await feedback.recordReaction({ artifact_id: cap.artifact_id, action: "regenerated" });
  };

  for (let i = 0; i < 3; i++) await fire(`art-A-${i}`, "draft:email");
  for (let i = 0; i < 2; i++) await fire(`art-B-${i}`, "draft:slack");

  await new Promise((r) => setTimeout(r, 50));

  console.log("\n--- After capture ---");
  console.log(
    `Crystallized task groups: ${Array.from(negativeContentTasks).join(" | ") || "(none)"}`,
  );
  console.log("Note: only draft:email crossed the 3-event threshold (draft:slack had 2)");

  subscription.unsubscribe();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
