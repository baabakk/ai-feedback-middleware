import { describe, it, expect } from "vitest";
import {
  evaluateRule,
  evaluateRules,
  type ActionabilityRule,
  type CapturedEvaluatedReactionEvent,
  type EvaluationVector,
} from "../src/index.js";

const NOW = "2026-04-10T00:00:00Z";

function rule(overrides: Partial<ActionabilityRule> = {}): ActionabilityRule {
  return {
    rule_id: "regenerate_burst_to_content_actionable_negative",
    rule_version: "1",
    applies_when: { action: "regenerated" },
    axis: "content",
    threshold: 3,
    window_ms: 60_000,
    result_if_met: "actionable_negative",
    active: true,
    ...overrides,
  };
}

function reaction(
  spec: {
    artifact_id: string;
    action: string;
    occurred_at: string;
    evaluations?: EvaluationVector;
  } & Partial<Omit<CapturedEvaluatedReactionEvent, "artifact_id" | "action" | "occurred_at" | "evaluations">>,
): CapturedEvaluatedReactionEvent {
  const { artifact_id, action, occurred_at, evaluations, ...rest } = spec;
  return {
    event_kind: "reaction",
    event_id: `evt-${artifact_id}-${occurred_at}`,
    event_version: 2,
    artifact_id,
    artifact_type: "draft_email",
    artifact_version: 0,
    partition_key: artifact_id,
    producer: "agent-a",
    task_type: "draft:email:warm",
    source: "explicit",
    action,
    evaluations: evaluations ?? { content: "negative" },
    classifier_version: "test-2.1",
    occurred_at,
    captured_at: occurred_at,
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...rest,
  };
}

function offsetSeconds(seconds: number): string {
  return new Date(Date.parse(NOW) - seconds * 1000).toISOString();
}

describe("evaluateRule — empty/inactive rules", () => {
  it("returns no decisions for an inactive rule", () => {
    const decisions = evaluateRule(rule({ active: false }), [], new Set(), { now: NOW });
    expect(decisions).toEqual([]);
  });

  it("returns no decisions when there are no candidates", () => {
    expect(evaluateRule(rule(), [], new Set(), { now: NOW })).toEqual([]);
  });
});

describe("evaluateRule — threshold counting (per artifact)", () => {
  it("emits one decision when threshold met for a single artifact", () => {
    const reactions = [
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(10) }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(20) }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(30) }),
    ];
    const decisions = evaluateRule(rule({ threshold: 3 }), reactions, new Set(), { now: NOW });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      artifact_id: "a-1",
      axis: "content",
      inference: "actionable_negative",
    });
    expect(decisions[0]?.evidence_event_ids).toHaveLength(3);
  });

  it("does not emit when threshold not yet reached", () => {
    const reactions = [
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(10) }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(20) }),
    ];
    expect(evaluateRule(rule({ threshold: 3 }), reactions, new Set(), { now: NOW })).toEqual([]);
  });

  it("groups by artifact_id: artifact crossing threshold emits, others do not", () => {
    const reactions = [
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(10) }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(20) }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(30) }),
      reaction({ artifact_id: "a-2", action: "regenerated", occurred_at: offsetSeconds(15) }),
    ];
    const decisions = evaluateRule(rule({ threshold: 3 }), reactions, new Set(), { now: NOW });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.artifact_id).toBe("a-1");
  });
});

describe("evaluateRule — window cutoff", () => {
  it("excludes reactions older than window_ms", () => {
    const reactions = [
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(10) }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(120) }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(300) }),
    ];
    const decisions = evaluateRule(
      rule({ threshold: 3, window_ms: 60_000 }),
      reactions,
      new Set(),
      { now: NOW },
    );
    // Only one reaction is within the 60s window.
    expect(decisions).toEqual([]);
  });
});

describe("evaluateRule — predicate filtering", () => {
  it("filters by action", () => {
    const reactions = [
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(5) }),
      reaction({
        artifact_id: "a-1",
        action: "rejected",
        occurred_at: offsetSeconds(10),
        evaluations: { content: "negative" },
      }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(15) }),
      reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(20) }),
    ];
    const decisions = evaluateRule(rule({ threshold: 3 }), reactions, new Set(), { now: NOW });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.evidence_event_ids).toHaveLength(3);
  });

  it("filters by task_type_prefix", () => {
    const reactions = [
      {
        ...reaction({ artifact_id: "a-1", action: "regenerated", occurred_at: offsetSeconds(5) }),
        task_type: "draft:email:warm",
      },
      {
        ...reaction({ artifact_id: "a-2", action: "regenerated", occurred_at: offsetSeconds(10) }),
        task_type: "linkedin:dm",
      },
      {
        ...reaction({ artifact_id: "a-3", action: "regenerated", occurred_at: offsetSeconds(15) }),
        task_type: "draft:sms",
      },
    ];
    const decisions = evaluateRule(
      rule({ applies_when: { action: "regenerated", task_type_prefix: "draft:" }, threshold: 1 }),
      reactions,
      new Set(),
      { now: NOW },
    );
    expect(decisions.map((d) => d.artifact_id).sort()).toEqual(["a-1", "a-3"]);
  });
});

describe("evaluateRule — axis-direction matching", () => {
  it("counts only reactions whose evaluations[axis] matches the rule's intended direction", () => {
    const reactions = [
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(5),
        evaluations: { content: "negative" },
      }),
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(10),
        evaluations: { content: "positive" }, // wrong direction; excluded
      }),
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(15),
        evaluations: { content: "negative" },
      }),
    ];
    const decisions = evaluateRule(rule({ threshold: 2 }), reactions, new Set(), { now: NOW });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.evidence_event_ids).toHaveLength(2);
  });

  it("excludes reactions with no signal on the rule's axis", () => {
    const reactions = [
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(5),
        evaluations: { content: "negative" },
      }),
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(10),
        evaluations: {}, // no axis signal; excluded
      }),
    ];
    const decisions = evaluateRule(rule({ threshold: 2 }), reactions, new Set(), { now: NOW });
    expect(decisions).toEqual([]);
  });
});

describe("evaluateRule — tombstone filtering (direction-symmetric)", () => {
  it("excludes a tombstoned artifact regardless of which direction its evidence was trending", () => {
    const reactions = [
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(5),
        evaluations: { content: "negative" },
      }),
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(10),
        evaluations: { content: "negative" },
      }),
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(15),
        evaluations: { content: "negative" },
      }),
    ];
    const decisions = evaluateRule(rule({ threshold: 3 }), reactions, new Set(["a-1"]), {
      now: NOW,
    });
    expect(decisions).toEqual([]);
  });

  it("filters tombstone-action reactions out even when not in the tombstoned set", () => {
    const reactions = [
      reaction({
        artifact_id: "a-1",
        action: "cancelled",
        occurred_at: offsetSeconds(5),
        evaluations: { content: "negative" },
      }),
    ];
    expect(evaluateRule(rule({ threshold: 1 }), reactions, new Set(), { now: NOW })).toEqual([]);
  });
});

describe("evaluateRules — batch", () => {
  it("flattens decisions across multiple rules", () => {
    const r1 = rule({ rule_id: "r1", axis: "content", threshold: 1 });
    const r2 = rule({ rule_id: "r2", axis: "timing", threshold: 1, result_if_met: "actionable_negative" });
    const reactions = [
      reaction({
        artifact_id: "a-1",
        action: "regenerated",
        occurred_at: offsetSeconds(5),
        evaluations: { content: "negative", timing: "negative" },
      }),
    ];
    const decisions = evaluateRules([r1, r2], reactions, new Set(), { now: NOW });
    expect(decisions.map((d) => d.rule_id).sort()).toEqual(["r1", "r2"]);
  });
});
