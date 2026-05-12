/**
 * daily-briefing-silent-accept — the accept-by-default partner to
 * email-draft-approval.
 *
 * Scenario: a daily briefing or summary lands in the user's inbox at 7am.
 * They read it (or don't). If they don't push back, the framework counts
 * that as endorsement — `silently_accepted` is implicit positive on
 * `detection` and `content`. If they DO push back ("nope, this brief is
 * wrong"), they `manually_replaced` it with their own version, which is a
 * strong content-axis negative.
 *
 * The contrast with email-draft-approval is the whole point of
 * `expirationPolicy`: silence means different things in different domains,
 * and the framework forces the consumer to pick once at registration
 * time. Inheritance or a global default would let consumers ignore the
 * question, and that's the failure mode that produces incoherent
 * implicit-feedback data downstream.
 */
import {
  acceptByDefault,
  createFeedback,
  createLifecycleWorker,
  DEFAULT_ACTIONS,
  type CapturedEvaluatedReactionEvent,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";

async function main(): Promise<void> {
  const trackedArtifacts = createInMemoryTrackedArtifactsStore();
  const feedback = createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    trackedArtifacts,
    actions: DEFAULT_ACTIONS,
    artifactTypes: [acceptByDefault("morning_briefing")],
  });

  const worker = createLifecycleWorker({
    capture: feedback,
    trackedArtifacts,
    artifactTypes: [acceptByDefault("morning_briefing")],
    leaseOwner: "demo-worker",
    pollIntervalMs: 200,
  });
  void worker.start();

  const shortDeadline = (): string => new Date(Date.now() + 1000).toISOString();

  console.log("--- Capturing 3 morning briefings ---\n");

  // (a) silent — user read it, found nothing wrong, moved on.
  await feedback.captureArtifact({
    artifact_type: "morning_briefing",
    artifact_id: "brief-mon",
    artifact_version: 1,
    producer: "chief-of-staff-agent",
    task_type: "morning_brief",
    payload: { date: "2026-05-12", highlights: ["3 deals advanced", "1 risk flagged"] },
    expires_at: shortDeadline(),
  });

  // (b) explicit approve — user actually clicked "looks good" (rare).
  const briefTue = await feedback.captureArtifact({
    artifact_type: "morning_briefing",
    artifact_id: "brief-tue",
    artifact_version: 1,
    producer: "chief-of-staff-agent",
    task_type: "morning_brief",
    payload: { date: "2026-05-13", highlights: ["RFP submitted"] },
    expires_at: shortDeadline(),
  });
  await feedback.recordReaction({
    artifact_id: briefTue.artifact_id,
    action: "approved",
    payload: { actor_id: "babak" },
  });

  // (c) user wrote their own brief from scratch — manually_replaced is the
  //     strongest content-axis negative because the framework's output was
  //     so far off the user redid the task entirely.
  const briefWed = await feedback.captureArtifact({
    artifact_type: "morning_briefing",
    artifact_id: "brief-wed",
    artifact_version: 1,
    producer: "chief-of-staff-agent",
    task_type: "morning_brief",
    payload: { date: "2026-05-14", highlights: ["misread the calendar"] },
    expires_at: shortDeadline(),
  });
  await feedback.recordReaction({
    artifact_id: briefWed.artifact_id,
    action: "manually_replaced",
    payload: {
      actor_id: "babak",
      replacement:
        "Today: investor sync at 10, prod incident postmortem at 2, no other commitments.",
    },
  });

  console.log("--- Waiting for the Lifecycle Worker to fire on the silenced brief ---\n");
  await new Promise((r) => setTimeout(r, 1500));
  await worker.stop();

  console.log("--- Reaction log ---\n");
  const reactions: CapturedEvaluatedReactionEvent[] = [];
  for await (const r of feedback.readReactions()) reactions.push(r);
  for (const r of reactions) {
    const e = r.evaluations;
    const axes = (["detection", "content", "timing", "channel"] as const)
      .map((a) => `${a[0]}=${e[a] ?? "—"}`)
      .join(" ");
    console.log(
      `  ${r.artifact_id.padEnd(12)} action=${r.action.padEnd(22)} src=${r.source.padEnd(8)} ${axes}`,
    );
  }

  console.log("\n--- Lifecycle status by type ---\n");
  const counts = await trackedArtifacts.countByStatus();
  for (const [status, n] of Object.entries(counts)) {
    console.log(`  ${status}: ${n}`);
  }

  console.log("\nKey takeaways:");
  console.log(
    "  • Same framework, opposite policy: silence here is endorsement (`silently_accepted`),",
  );
  console.log(
    "    not rejection. Pick the policy at registration time; no global default exists by design.",
  );
  console.log(
    "  • `silently_accepted` is implicit-positive on detection + content (the user did not",
  );
  console.log(
    "    push back, so the framework reads that as the trigger + content being acceptable).",
  );
  console.log(
    "    Timing and channel are deliberately empty — silence cannot disambiguate a brief that",
  );
  console.log("    was perfect from one that was never seen.");
  console.log(
    "  • `manually_replaced` carries a different signal than `manually_edited`: edit means",
  );
  console.log(
    "    the user kept and adjusted the framework's output; replaced means they threw it out",
  );
  console.log(
    "    and did the task from scratch. Diff size in payload distinguishes them at write time.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
