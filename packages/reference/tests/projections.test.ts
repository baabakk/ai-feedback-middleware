import { describe, it, expect } from "vitest";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  type CapturePort,
  type ProjectionBuilder,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";
import {
  approvalRateProjection,
  createApprovedExamplesProjection,
  createRemovedPhrasesProjection,
  type ApprovalRateState,
  type ApprovedExamplesState,
  type RemovedPhrasesState,
} from "../src/index.js";

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function makeFeedback(projections: ProjectionBuilder<unknown>[]): CapturePort {
  return createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    trackedArtifacts: createInMemoryTrackedArtifactsStore(),
    actions: DEFAULT_ACTIONS,
    artifactTypes: [rejectByDefault("draft_email")],
    projections,
  });
}

async function captureAndReact(
  feedback: CapturePort,
  artifact_id: string,
  action: string,
  options: { producer?: string; task_type?: string; payload?: unknown } = {},
): Promise<void> {
  const cap = await feedback.captureArtifact({
    artifact_type: "draft_email",
    artifact_id,
    artifact_version: 1,
    producer: options.producer ?? "agent",
    task_type: options.task_type ?? "draft:email",
    payload: {},
    expires_at: FUTURE,
  });
  await feedback.recordReaction({
    artifact_id: cap.artifact_id,
    action,
    payload: options.payload,
  });
}

describe("approvalRateProjection", () => {
  it("computes approval rate across approved and rejected reactions", async () => {
    const feedback = makeFeedback([approvalRateProjection]);
    await captureAndReact(feedback, "a-1", "approved");
    await captureAndReact(feedback, "a-2", "approved");
    await captureAndReact(feedback, "a-3", "rejected");

    const states = await feedback.queryProjection<ApprovalRateState>("approval_rate", undefined);
    expect(states.length).toBe(1);
    expect(states[0]!.total).toBe(3);
    expect(states[0]!.approved).toBe(2);
    expect(states[0]!.negative).toBe(1);
    expect(states[0]!.approvalRate).toBeCloseTo(2 / 3, 5);
  });

  it("isolates state per (producer, task_type)", async () => {
    const feedback = makeFeedback([approvalRateProjection]);
    await captureAndReact(feedback, "a-1", "approved", {
      producer: "agent-A",
      task_type: "task-X",
    });
    await captureAndReact(feedback, "a-2", "rejected", {
      producer: "agent-B",
      task_type: "task-Y",
    });

    const states = await feedback.queryProjection<ApprovalRateState>("approval_rate", undefined);
    expect(states.length).toBe(2);
    const approvalRates = states.map((s) => s.approvalRate).sort();
    expect(approvalRates).toEqual([0, 1]);
  });
});

describe("createApprovedExamplesProjection", () => {
  it("collects approved reactions into a per-key library", async () => {
    const feedback = makeFeedback([createApprovedExamplesProjection({ capPerKey: 3 })]);
    await captureAndReact(feedback, "a-1", "approved", {
      payload: { artifact_hash: "sha256:1" },
    });
    await captureAndReact(feedback, "a-2", "approved", {
      payload: { artifact_hash: "sha256:2" },
    });
    // Reject should NOT be added.
    await captureAndReact(feedback, "a-3", "rejected");

    const states = await feedback.queryProjection<ApprovedExamplesState>(
      "approved_examples",
      undefined,
    );
    expect(states.length).toBe(1);
    expect(states[0]!.examples).toHaveLength(2);
    expect(states[0]!.examples[0]!.artifact_id).toBe("a-1");
    expect(states[0]!.examples[1]!.artifact_id).toBe("a-2");
  });

  it("respects capPerKey by evicting older examples", async () => {
    const feedback = makeFeedback([createApprovedExamplesProjection({ capPerKey: 2 })]);
    for (const id of ["a-1", "a-2", "a-3", "a-4"]) {
      await captureAndReact(feedback, id, "approved");
    }
    const states = await feedback.queryProjection<ApprovedExamplesState>(
      "approved_examples",
      undefined,
    );
    expect(states[0]!.examples).toHaveLength(2);
    expect(states[0]!.examples[0]!.artifact_id).toBe("a-3");
    expect(states[0]!.examples[1]!.artifact_id).toBe("a-4");
  });
});

describe("createRemovedPhrasesProjection", () => {
  it("counts watched phrases removed by manually_edited reactions", async () => {
    const feedback = makeFeedback([createRemovedPhrasesProjection()]);

    await captureAndReact(feedback, "a-1", "manually_edited", {
      payload: {
        original: "Dear Sir/Madam, I hope this email finds you well. Per our chat,",
        corrected: "Dear Sir/Madam, Per our chat,",
      },
    });
    await captureAndReact(feedback, "a-2", "manually_edited", {
      payload: {
        original: "I wanted to reach out about leveraging synergies between our teams.",
        corrected: "Following up on our conversation.",
      },
    });

    const [state] = await feedback.queryProjection<RemovedPhrasesState>(
      "removed_phrases",
      undefined,
    );
    expect(state!.phrases["i hope this email finds you well"]?.count).toBe(1);
    expect(state!.phrases["i wanted to reach out"]?.count).toBe(1);
    expect(state!.phrases["leveraging synergies"]?.count).toBe(1);
  });

  it("does not increment when phrase is preserved through the edit", async () => {
    const feedback = makeFeedback([createRemovedPhrasesProjection()]);
    await captureAndReact(feedback, "a-1", "manually_edited", {
      payload: {
        original: "Hi John, I hope this finds you well — got a question.",
        corrected: "Hi John, I hope this finds you well, here's the question:",
      },
    });
    const [state] = await feedback.queryProjection<RemovedPhrasesState>(
      "removed_phrases",
      undefined,
    );
    expect(state?.phrases["i hope this finds you well"]).toBeUndefined();
  });

  it("ignores actions other than manually_edited", async () => {
    const feedback = makeFeedback([createRemovedPhrasesProjection()]);
    await captureAndReact(feedback, "a-1", "approved");
    const states = await feedback.queryProjection<RemovedPhrasesState>(
      "removed_phrases",
      undefined,
    );
    // Builder applied to no events, so no row exists.
    expect(states.length).toBe(0);
  });
});
