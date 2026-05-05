import { describe, it, expect } from "vitest";
import { createFeedback, DEFAULT_ACTIONS } from "@llm-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
} from "@llm-feedback-middleware/in-memory";
import {
  approvalRateProjection,
  createWhitelistExamplesProjection,
  createBlacklistPhrasesProjection,
  type ApprovalRateState,
  type WhitelistExamplesState,
  type BlacklistPhrasesState,
} from "../src/index.js";

describe("approvalRateProjection", () => {
  it("computes approval rate correctly across approves and rejects", async () => {
    const feedback = createFeedback({
      eventStore: createInMemoryEventStore(),
      projectionStore: createInMemoryProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [approvalRateProjection],
    });

    // Two approves, one reject -> 2/3 ≈ 0.666
    await feedback.capture({
      action: "approve",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "agent",
      task_type: "draft:email",
      payload: {},
    });
    await feedback.capture({
      action: "approve",
      artifact_type: "draft",
      artifact_id: "a-2",
      artifact_version: 1,
      producer: "agent",
      task_type: "draft:email",
      payload: {},
    });
    await feedback.capture({
      action: "reject",
      artifact_type: "draft",
      artifact_id: "a-3",
      artifact_version: 1,
      producer: "agent",
      task_type: "draft:email",
      payload: {},
    });

    const states = await feedback.queryProjection<ApprovalRateState>("approval_rate", undefined);
    expect(states.length).toBe(1);
    expect(states[0]!.total).toBe(3);
    expect(states[0]!.approved).toBe(2);
    expect(states[0]!.negative).toBe(1);
    expect(states[0]!.approvalRate).toBeCloseTo(2 / 3, 5);
  });

  it("isolates state per (producer, task_type)", async () => {
    const feedback = createFeedback({
      eventStore: createInMemoryEventStore(),
      projectionStore: createInMemoryProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [approvalRateProjection],
    });

    await feedback.capture({
      action: "approve",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "agent-A",
      task_type: "task-X",
      payload: {},
    });
    await feedback.capture({
      action: "reject",
      artifact_type: "draft",
      artifact_id: "a-2",
      artifact_version: 1,
      producer: "agent-B",
      task_type: "task-Y",
      payload: {},
    });

    const states = await feedback.queryProjection<ApprovalRateState>("approval_rate", undefined);
    expect(states.length).toBe(2);
    const approvalRates = states.map((s) => s.approvalRate).sort();
    expect(approvalRates).toEqual([0, 1]);
  });
});

describe("createWhitelistExamplesProjection", () => {
  it("collects whitelist events into a per-key library", async () => {
    const feedback = createFeedback({
      eventStore: createInMemoryEventStore(),
      projectionStore: createInMemoryProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [createWhitelistExamplesProjection()],
    });

    for (let i = 0; i < 3; i++) {
      await feedback.capture({
        action: "approve",
        artifact_type: "draft",
        artifact_id: `a-${i}`,
        artifact_version: 1,
        producer: "agent",
        task_type: "draft:email",
        payload: { artifact_hash: `sha256:${i}` },
      });
    }

    const states = await feedback.queryProjection<WhitelistExamplesState>(
      "whitelist_examples",
      undefined,
    );
    expect(states.length).toBe(1);
    expect(states[0]!.examples.length).toBe(3);
    expect(states[0]!.examples.map((e) => e.artifact_id)).toEqual(["a-0", "a-1", "a-2"]);
  });

  it("respects capPerKey by evicting oldest", async () => {
    const feedback = createFeedback({
      eventStore: createInMemoryEventStore(),
      projectionStore: createInMemoryProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [createWhitelistExamplesProjection({ capPerKey: 2 })],
    });

    for (let i = 0; i < 5; i++) {
      await feedback.capture({
        action: "approve",
        artifact_type: "draft",
        artifact_id: `a-${i}`,
        artifact_version: 1,
        producer: "agent",
        task_type: "draft:email",
        payload: {},
      });
    }

    const states = await feedback.queryProjection<WhitelistExamplesState>(
      "whitelist_examples",
      undefined,
    );
    expect(states[0]!.examples.length).toBe(2);
    // Should keep the most recent two
    expect(states[0]!.examples.map((e) => e.artifact_id)).toEqual(["a-3", "a-4"]);
  });

  it("ignores non-whitelist events", async () => {
    const feedback = createFeedback({
      eventStore: createInMemoryEventStore(),
      projectionStore: createInMemoryProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [createWhitelistExamplesProjection()],
    });

    await feedback.capture({
      action: "reject",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "agent",
      task_type: "draft:email",
      payload: {},
    });

    const states = await feedback.queryProjection<WhitelistExamplesState>(
      "whitelist_examples",
      undefined,
    );
    expect(states.length).toBe(0);
  });
});

describe("createBlacklistPhrasesProjection", () => {
  it("counts watched phrases removed by edits", async () => {
    const feedback = createFeedback({
      eventStore: createInMemoryEventStore(),
      projectionStore: createInMemoryProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [createBlacklistPhrasesProjection()],
    });

    // Edit removes "i hope this email finds you well"
    await feedback.capture({
      action: "edit",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "agent",
      task_type: "draft:email",
      payload: {
        original: "Hi John,\n\nI hope this email finds you well.\n\nThanks!",
        corrected: "Hi John,\n\nThanks!",
      },
    });

    const states = await feedback.queryProjection<BlacklistPhrasesState>(
      "blacklist_phrases",
      undefined,
    );
    expect(states.length).toBe(1);
    expect(states[0]!.phrases["i hope this email finds you well"]?.count).toBe(1);
  });

  it("does not count when phrase remains in corrected text", async () => {
    const feedback = createFeedback({
      eventStore: createInMemoryEventStore(),
      projectionStore: createInMemoryProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [createBlacklistPhrasesProjection()],
    });

    await feedback.capture({
      action: "edit",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "agent",
      task_type: "draft:email",
      payload: {
        original: "Hi, I hope this finds you well.",
        corrected: "Hello, I hope this finds you well today.",
      },
    });

    const states = await feedback.queryProjection<BlacklistPhrasesState>(
      "blacklist_phrases",
      undefined,
    );
    // Phrase remained in both, so no increment.
    expect(Object.keys(states[0]?.phrases ?? {}).length).toBe(0);
  });

  it("supports custom watch list", async () => {
    const feedback = createFeedback({
      eventStore: createInMemoryEventStore(),
      projectionStore: createInMemoryProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [createBlacklistPhrasesProjection({ watchPhrases: ["robust"] })],
    });

    await feedback.capture({
      action: "edit",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "agent",
      task_type: "draft:email",
      payload: {
        original: "We need a robust solution.",
        corrected: "We need a solution.",
      },
    });

    const states = await feedback.queryProjection<BlacklistPhrasesState>(
      "blacklist_phrases",
      undefined,
    );
    expect(states[0]!.phrases["robust"]?.count).toBe(1);
  });
});
