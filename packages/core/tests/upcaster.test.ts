import { describe, it, expect } from "vitest";
import {
  type CapturedEvaluatedReactionEvent,
  type EventUpcaster,
  type FeedbackEvent,
  upcastEvent,
  upcastStream,
  v1ToV2_1Upcaster,
  validateUpcasterChain,
} from "../src/index.js";

/**
 * Build a v2-shaped reaction event for the version-arithmetic tests below.
 * The actual v1 -> v2.1 translation is exercised in the dedicated section.
 */
function makeReactionAtVersion(
  version: number,
  overrides: Partial<CapturedEvaluatedReactionEvent> = {},
): FeedbackEvent {
  return {
    event_kind: "reaction",
    event_id: "e1",
    event_version: version,
    artifact_id: "p-1",
    artifact_type: "draft_email",
    artifact_version: 1,
    partition_key: "p-1",
    producer: "test",
    task_type: "test",
    source: "explicit",
    action: "approved",
    evaluations: { content: "positive" },
    classifier_version: "test-2.1",
    occurred_at: "2026-04-24T00:00:00Z",
    captured_at: "2026-04-24T00:00:00Z",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

describe("validateUpcasterChain", () => {
  it("accepts an empty chain at currentSchemaVersion 1", () => {
    expect(() => validateUpcasterChain([], 1)).not.toThrow();
  });

  it("rejects upcasters when currentSchemaVersion is 1", () => {
    const u: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e as FeedbackEvent };
    expect(() => validateUpcasterChain([u], 1)).toThrow(/currentSchemaVersion is 1/);
  });

  it("accepts a contiguous chain v1 -> v2 -> v3", () => {
    const u1: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e as FeedbackEvent };
    const u2: EventUpcaster = { fromVersion: 2, toVersion: 3, upcast: (e) => e as FeedbackEvent };
    expect(() => validateUpcasterChain([u1, u2], 3)).not.toThrow();
  });

  it("accepts chain registered out of order (sorted internally)", () => {
    const u1: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e as FeedbackEvent };
    const u2: EventUpcaster = { fromVersion: 2, toVersion: 3, upcast: (e) => e as FeedbackEvent };
    expect(() => validateUpcasterChain([u2, u1], 3)).not.toThrow();
  });

  it("rejects gap in chain (caught by positional check)", () => {
    const u1: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e as FeedbackEvent };
    const u3: EventUpcaster = { fromVersion: 3, toVersion: 4, upcast: (e) => e as FeedbackEvent };
    expect(() => validateUpcasterChain([u1, u3], 4)).toThrow(
      /Expected upcaster v2->v3, got v3->v4/,
    );
  });

  it("rejects truly missing upcaster (chain too short)", () => {
    const u1: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e as FeedbackEvent };
    expect(() => validateUpcasterChain([u1], 4)).toThrow(/Missing upcaster from v2 to v3/);
  });

  it("rejects upcaster that skips versions", () => {
    const bad: EventUpcaster = { fromVersion: 1, toVersion: 3, upcast: (e) => e as FeedbackEvent };
    expect(() => validateUpcasterChain([bad], 3)).toThrow(/Expected upcaster v1->v2/);
  });

  it("rejects currentSchemaVersion < 1", () => {
    expect(() => validateUpcasterChain([], 0)).toThrow(/must be >= 1/);
  });
});

describe("upcastEvent (general semantics)", () => {
  it("passes through events already at currentSchemaVersion", () => {
    const e = makeReactionAtVersion(2);
    const result = upcastEvent(e, [], 2);
    expect(result).toBe(e);
  });

  it("applies a single upcaster v1 -> v2 (synthetic shape)", () => {
    const u: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: (event) => ({
        ...(event as CapturedEvaluatedReactionEvent),
        event_version: 2,
      }),
    };
    const e = makeReactionAtVersion(1);
    const result = upcastEvent(e, [u], 2);
    expect(result.event_version).toBe(2);
  });

  it("chains multiple upcasters v1 -> v2 -> v3", () => {
    const u1: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: (e) => ({
        ...(e as CapturedEvaluatedReactionEvent),
        event_version: 2,
        payload: { step: "v2" },
      }),
    };
    const u2: EventUpcaster = {
      fromVersion: 2,
      toVersion: 3,
      upcast: (e) => ({
        ...(e as CapturedEvaluatedReactionEvent),
        event_version: 3,
        payload: { ...((e as CapturedEvaluatedReactionEvent).payload as object), step: "v3" },
      }),
    };
    const e = makeReactionAtVersion(1);
    const result = upcastEvent(e, [u1, u2], 3);
    expect(result.event_version).toBe(3);
    expect((result.payload as { step: string }).step).toBe("v3");
  });

  it("starts at the event's version (not always at v1)", () => {
    const u1: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: () => {
        throw new Error("should not run for v2 events");
      },
    };
    const u2: EventUpcaster = {
      fromVersion: 2,
      toVersion: 3,
      upcast: (e) => ({ ...(e as CapturedEvaluatedReactionEvent), event_version: 3 }),
    };
    const e = makeReactionAtVersion(2);
    const result = upcastEvent(e, [u1, u2], 3);
    expect(result.event_version).toBe(3);
  });

  it("throws when reader's currentSchemaVersion is older than event's", () => {
    const e = makeReactionAtVersion(3);
    expect(() => upcastEvent(e, [], 2)).toThrow(/Cannot read event/);
  });

  it("throws when an upcaster fails to bump event_version", () => {
    const buggy: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: (e) => e as FeedbackEvent,
    };
    const e = makeReactionAtVersion(1);
    expect(() => upcastEvent(e, [buggy], 2)).toThrow(/did not update event_version/);
  });
});

describe("upcastStream", () => {
  async function* gen(events: FeedbackEvent[]): AsyncIterable<FeedbackEvent> {
    for (const e of events) yield e;
  }

  async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const v of iter) out.push(v);
    return out;
  }

  it("upcasts every event in the stream", async () => {
    const u: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: (e) => ({ ...(e as CapturedEvaluatedReactionEvent), event_version: 2 }),
    };
    const events = [
      makeReactionAtVersion(1, { event_id: "a" }),
      makeReactionAtVersion(1, { event_id: "b" }),
    ];
    const result = await collect(upcastStream(gen(events), [u], 2));
    expect(result.every((e) => e.event_version === 2)).toBe(true);
  });

  it("passes through current-version events unchanged", async () => {
    const events = [
      makeReactionAtVersion(2, { event_id: "a" }),
      makeReactionAtVersion(2, { event_id: "b" }),
    ];
    const result = await collect(upcastStream(gen(events), [], 2));
    expect(result.length).toBe(2);
    expect(result.every((e) => e.event_version === 2)).toBe(true);
  });
});

describe("v1ToV2_1Upcaster (real translation)", () => {
  function v1Event(action: string, polarity: "positive" | "negative" | "neutral" = "positive") {
    return {
      event_id: "e1",
      event_version: 1,
      timestamp: "2026-04-24T00:00:00Z",
      captured_at: "2026-04-24T00:00:00Z",
      partition_key: "p-1",
      source: action === "expired" || action === "silent_accept" ? "implicit" : "explicit",
      polarity,
      inference: "observe",
      action,
      artifact_type: "draft",
      artifact_id: "p-1",
      artifact_version: 1,
      producer: "test",
      task_type: "test",
      payload: { dummy: true },
      provenance: { channel: "test", captured_by_adapter: "test" },
    };
  }

  it("renames v1 actions to past-tense (approve -> approved)", () => {
    const r = v1ToV2_1Upcaster.upcast(v1Event("approve")) as CapturedEvaluatedReactionEvent;
    expect(r.event_kind).toBe("reaction");
    expect(r.action).toBe("approved");
    expect(r.event_version).toBe(2);
  });

  it("translates v1 'edit' to v2 'manually_edited' with content negative", () => {
    const r = v1ToV2_1Upcaster.upcast(
      v1Event("edit", "negative"),
    ) as CapturedEvaluatedReactionEvent;
    expect(r.action).toBe("manually_edited");
    expect(r.evaluations.content).toBe("negative");
  });

  it("translates v1 'expired' to v2 'silently_rejected_expired'", () => {
    const r = v1ToV2_1Upcaster.upcast(
      v1Event("expired", "negative"),
    ) as CapturedEvaluatedReactionEvent;
    expect(r.action).toBe("silently_rejected_expired");
    expect(r.source).toBe("implicit");
  });

  it("translates v1 'silent_accept' to v2 'silently_accepted'", () => {
    const r = v1ToV2_1Upcaster.upcast(
      v1Event("silent_accept", "positive"),
    ) as CapturedEvaluatedReactionEvent;
    expect(r.action).toBe("silently_accepted");
    expect(r.evaluations).toEqual({ detection: "positive", content: "positive" });
  });

  it("preserves payload and provenance", () => {
    const r = v1ToV2_1Upcaster.upcast(v1Event("approve")) as CapturedEvaluatedReactionEvent;
    expect((r.payload as { dummy: boolean }).dummy).toBe(true);
    expect(r.provenance.channel).toBe("test");
  });

  it("stamps classifier_version='upcasted-v1' so callers can distinguish translated events", () => {
    const r = v1ToV2_1Upcaster.upcast(v1Event("approve")) as CapturedEvaluatedReactionEvent;
    expect(r.classifier_version).toBe("upcasted-v1");
  });

  it("neutral polarity collapses to empty per-axis evaluations", () => {
    // 'rejected' has content:negative as default, so a 'neutral' upcast should
    // still keep the action's heuristic for known actions. Use an unknown
    // action to see the polarityFallback path.
    const e = v1Event("custom_action", "neutral");
    const r = v1ToV2_1Upcaster.upcast(e) as CapturedEvaluatedReactionEvent;
    expect(r.evaluations).toEqual({});
  });

  it("rejects events at version != 1", () => {
    const e = { ...v1Event("approve"), event_version: 2 };
    expect(() => v1ToV2_1Upcaster.upcast(e)).toThrow(/event_version=1/);
  });
});
