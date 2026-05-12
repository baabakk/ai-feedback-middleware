/**
 * email-draft-approval — the canonical reject-by-default approval flow.
 *
 * Scenario: an AI agent drafts an outbound email. The framework captures it
 * and waits for the user. The user can:
 *   - approve as-is (rare, gold-quality output)
 *   - manually edit (most common — keep + adjust)
 *   - reject (regenerate from scratch)
 *   - silence (don't react before the deadline)
 *
 * Because `rejectByDefault` is set, silence is read as rejection: the
 * Lifecycle Worker fires `silently_rejected_expired` on deadline so the
 * outbound action is NEVER taken without an explicit approval. This is the
 * pattern any system that "needs human sign-off before sending" should use.
 *
 * This example simulates four artifacts with the four outcomes in parallel,
 * then prints the resulting reaction log + per-axis evaluations.
 */
import {
  createFeedback,
  createLifecycleWorker,
  DEFAULT_ACTIONS,
  rejectByDefault,
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
    artifactTypes: [rejectByDefault("draft_email")],
  });

  // Lifecycle Worker — wired to the same CapturePort and TrackedArtifactsPort.
  // 200ms poll so the demo runs quickly; production defaults to 30s.
  const worker = createLifecycleWorker({
    capture: feedback,
    trackedArtifacts,
    artifactTypes: [rejectByDefault("draft_email")],
    leaseOwner: "demo-worker",
    pollIntervalMs: 200,
  });
  void worker.start();

  // 1-second deadline on every draft so the silence-path resolves while we watch.
  const shortDeadline = (): string => new Date(Date.now() + 1000).toISOString();

  console.log("--- Capturing 4 drafts with different outcomes ---\n");

  // (a) explicit approval
  const drafted1 = await feedback.captureArtifact({
    artifact_type: "draft_email",
    artifact_id: "draft-warm-intro",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "outbound:warm_intro",
    payload: { subject: "Following up on our chat", recipient: "alice@example.com" },
    expires_at: shortDeadline(),
  });
  await feedback.recordReaction({
    artifact_id: drafted1.artifact_id,
    action: "approved",
    payload: { actor_id: "babak" },
  });

  // (b) manual edit — user kept the draft but rewrote the opener
  const drafted2 = await feedback.captureArtifact({
    artifact_type: "draft_email",
    artifact_id: "draft-cold-outreach",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "outbound:cold_outreach",
    payload: { subject: "Quick intro", recipient: "bob@example.com" },
    expires_at: shortDeadline(),
  });
  await feedback.recordReaction({
    artifact_id: drafted2.artifact_id,
    action: "manually_edited",
    payload: {
      actor_id: "babak",
      original: "I hope this email finds you well.",
      corrected: "Hi Bob,",
      diff_labels: ["remove_formality", "personalize"],
    },
  });

  // (c) outright reject — content was wrong enough that user wanted to regenerate
  const drafted3 = await feedback.captureArtifact({
    artifact_type: "draft_email",
    artifact_id: "draft-bad-tone",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "outbound:apology",
    payload: { subject: "Re: yesterday", recipient: "carol@example.com" },
    expires_at: shortDeadline(),
  });
  await feedback.recordReaction({
    artifact_id: drafted3.artifact_id,
    action: "rejected",
    payload: { actor_id: "babak", reason: "tone too casual for the context" },
  });

  // (d) silence — user never opens the approval. Lifecycle Worker fires
  //     silently_rejected_expired after the deadline.
  await feedback.captureArtifact({
    artifact_type: "draft_email",
    artifact_id: "draft-forgot-about-me",
    artifact_version: 1,
    producer: "secretary-agent",
    task_type: "outbound:check_in",
    payload: { subject: "Hello again", recipient: "dan@example.com" },
    expires_at: shortDeadline(),
  });

  console.log("--- Waiting for the Lifecycle Worker to fire on the silenced draft ---\n");
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
      `  ${r.artifact_id.padEnd(28)} action=${r.action.padEnd(28)} ${axes}`,
    );
  }

  console.log("\n--- Final lifecycle status by artifact ---\n");
  const counts = await trackedArtifacts.countByStatus();
  for (const [status, n] of Object.entries(counts)) {
    console.log(`  ${status}: ${n}`);
  }

  console.log("\nKey takeaways:");
  console.log(
    "  • The silenced draft was NEVER auto-sent. rejectByDefault is the policy that lets you",
  );
  console.log(
    "    safely use this framework as a gate on outbound actions — silence === rejection.",
  );
  console.log("  • Approved sets all four axes positive; manually_edited keeps detection /");
  console.log("    timing / channel positive but flips content to negative (the user kept the");
  console.log(
    "    trigger but changed the content). Rejected leaves detection empty by design —",
  );
  console.log(
    "    a single rejection cannot disambiguate trigger-error from version-error.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
