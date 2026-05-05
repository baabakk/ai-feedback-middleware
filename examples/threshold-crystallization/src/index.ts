/**
 * Threshold-crystallization example using @llm-feedback-middleware/streams.
 *
 * Watches the bus for `regenerate` events and groups by (producer, task_type).
 * When 3 regenerates accumulate for the same group, promotes the task to
 * a blacklist (printed to stdout for the demo).
 *
 * This is the canonical use case for the streams package: stateful
 * across-event aggregation that's awkward in plain callbacks.
 *
 * Run: pnpm --filter threshold-crystallization start
 */
import { createFeedback, DEFAULT_ACTIONS } from "@llm-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryEventBus,
} from "@llm-feedback-middleware/in-memory";
import {
  toEventStream,
  filter,
  groupBy,
  mergeMap,
  bufferCount,
  tap,
} from "@llm-feedback-middleware/streams";

async function main(): Promise<void> {
  const eventBus = createInMemoryEventBus();
  const feedback = createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    eventBus,
    actions: DEFAULT_ACTIONS,
    artifactTypes: [{ name: "draft" }],
  });

  // Subscriber: count regenerates per (producer, task_type); fire when threshold met.
  const blacklisted = new Set<string>();
  const subscription = toEventStream(eventBus, "feedback.captured.*")
    .pipe(
      filter((e) => e.action === "regenerate"),
      groupBy((e) => `${e.producer}::${e.task_type}`),
      mergeMap((group$) =>
        group$.pipe(
          bufferCount(3),
          tap((batch) => {
            const key = `${batch[0]!.producer}::${batch[0]!.task_type}`;
            blacklisted.add(key);
            console.log(
              `\n  PROMOTED TO BLACKLIST: ${key} ` +
                `(${batch.length} regenerate events: ${batch.map((e) => e.event_id).join(", ")})`,
            );
          }),
        ),
      ),
    )
    .subscribe();

  console.log("--- Capturing 5 regenerate events: 3 on art-A, 2 on art-B ---");
  const fire = (artId: string, taskType: string) =>
    feedback.capture({
      action: "regenerate",
      artifact_type: "draft",
      artifact_id: artId,
      artifact_version: 1,
      producer: "demo-agent",
      task_type: taskType,
      payload: {},
    });

  for (let i = 0; i < 3; i++) await fire(`art-A-${i}`, "draft:email");
  for (let i = 0; i < 2; i++) await fire(`art-B-${i}`, "draft:slack");

  // Tiny wait so the in-memory bus has flushed.
  await new Promise((r) => setTimeout(r, 50));

  console.log("\n--- After capture ---");
  console.log(`Blacklisted task groups: ${Array.from(blacklisted).join(" | ") || "(none)"}`);
  console.log("Note: only draft:email crossed the 3-event threshold (draft:slack only had 2)");

  subscription.unsubscribe();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
