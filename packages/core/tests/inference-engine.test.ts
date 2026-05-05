import { describe, it, expect } from "vitest";
import { evaluateRules, type InferenceContext, type InferenceRule } from "../src/index.js";

const NOW = "2026-04-10T00:00:00Z";

function rule(overrides: Partial<InferenceRule> = {}): InferenceRule {
  return {
    rule_id: "test_rule",
    applies_when: { action: "expired" },
    threshold: 5,
    window_ms: 7 * 24 * 60 * 60 * 1000,
    result_if_met: "blacklist",
    active: true,
    ...overrides,
  };
}

function ctx(overrides: Partial<InferenceContext> = {}): InferenceContext {
  return {
    action: "expired",
    task_type: "draft:email",
    producer: "agent-a",
    artifact_type: "draft",
    recentActions: [],
    now: NOW,
    ...overrides,
  };
}

function recent(action: string, isoOffsetDays: number): { action: string; timestamp: string } {
  const nowMs = Date.parse(NOW);
  const ts = new Date(nowMs - isoOffsetDays * 24 * 60 * 60 * 1000).toISOString();
  return { action, timestamp: ts };
}

describe("evaluateRules — empty rules", () => {
  it("returns the default inference when no rules registered", () => {
    expect(evaluateRules([], ctx(), "observe")).toBe("observe");
    expect(evaluateRules([], ctx(), "whitelist")).toBe("whitelist");
  });
});

describe("evaluateRules — threshold counting", () => {
  it("returns result_if_met when threshold is reached exactly", () => {
    const result = evaluateRules(
      [rule({ threshold: 3 })],
      ctx({
        recentActions: [recent("expired", 1), recent("expired", 2), recent("expired", 3)],
      }),
      "observe",
    );
    expect(result).toBe("blacklist");
  });

  it("returns result_if_unmet (default observe) when below threshold", () => {
    const result = evaluateRules(
      [rule({ threshold: 5 })],
      ctx({
        recentActions: [recent("expired", 1), recent("expired", 2)],
      }),
      "observe",
    );
    expect(result).toBe("observe");
  });

  it("respects custom result_if_unmet", () => {
    const result = evaluateRules(
      [rule({ threshold: 5, result_if_unmet: "whitelist" })],
      ctx({
        recentActions: [recent("expired", 1)],
      }),
      "observe",
    );
    expect(result).toBe("whitelist");
  });
});

describe("evaluateRules — window cutoff", () => {
  it("ignores events older than window_ms", () => {
    const result = evaluateRules(
      [rule({ threshold: 3, window_ms: 1 * 24 * 60 * 60 * 1000 })], // 1 day
      ctx({
        recentActions: [
          recent("expired", 0.1), // inside window
          recent("expired", 0.2), // inside window
          recent("expired", 5), // outside window
        ],
      }),
      "observe",
    );
    expect(result).toBe("observe"); // only 2 inside, threshold is 3
  });

  it("counts events exactly at the boundary", () => {
    const result = evaluateRules(
      [rule({ threshold: 2, window_ms: 60_000 })],
      ctx({
        recentActions: [
          recent("expired", 0), // very recent
          recent("expired", 0.0005), // ~43 seconds ago
        ],
      }),
      "observe",
    );
    expect(result).toBe("blacklist");
  });
});

describe("evaluateRules — predicate matching", () => {
  it("matches by action only", () => {
    const r = rule({ applies_when: { action: "approve" }, threshold: 1 });
    const result = evaluateRules(
      [r],
      ctx({ action: "approve", recentActions: [recent("approve", 0.1)] }),
      "observe",
    );
    expect(result).toBe("blacklist");
  });

  it("does not match when action differs", () => {
    const r = rule({ applies_when: { action: "approve" }, threshold: 1 });
    const result = evaluateRules(
      [r],
      ctx({ action: "edit", recentActions: [recent("approve", 0.1)] }),
      "observe",
    );
    expect(result).toBe("observe");
  });

  it("matches by task_type exact", () => {
    const r = rule({
      applies_when: { task_type: "draft:email" },
      threshold: 1,
    });
    const result = evaluateRules(
      [r],
      ctx({ task_type: "draft:email", recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("blacklist");
  });

  it("does not match task_type when value differs", () => {
    const r = rule({
      applies_when: { task_type: "draft:email" },
      threshold: 1,
    });
    const result = evaluateRules(
      [r],
      ctx({ task_type: "draft:slack", recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("observe");
  });

  it("matches by task_type_prefix", () => {
    const r = rule({
      applies_when: { task_type_prefix: "draft:" },
      threshold: 1,
    });
    const result = evaluateRules(
      [r],
      ctx({ task_type: "draft:email:warm", recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("blacklist");
  });

  it("does not match task_type_prefix when value does not start with prefix", () => {
    const r = rule({
      applies_when: { task_type_prefix: "draft:" },
      threshold: 1,
    });
    const result = evaluateRules(
      [r],
      ctx({ task_type: "summary:morning", recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("observe");
  });

  it("matches by producer", () => {
    const r = rule({
      applies_when: { producer: "agent-a" },
      threshold: 1,
    });
    const result = evaluateRules(
      [r],
      ctx({ producer: "agent-a", recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("blacklist");
  });

  it("matches by artifact_type", () => {
    const r = rule({
      applies_when: { artifact_type: "draft" },
      threshold: 1,
    });
    const result = evaluateRules(
      [r],
      ctx({ artifact_type: "draft", recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("blacklist");
  });

  it("combines multiple predicate fields (all must match)", () => {
    const r = rule({
      applies_when: { action: "edit", task_type_prefix: "draft:" },
      threshold: 1,
    });
    // Both match
    expect(
      evaluateRules(
        [r],
        ctx({
          action: "edit",
          task_type: "draft:email",
          recentActions: [recent("edit", 0)],
        }),
        "observe",
      ),
    ).toBe("blacklist");
    // task_type does not match
    expect(
      evaluateRules(
        [r],
        ctx({
          action: "edit",
          task_type: "summary:morning",
          recentActions: [recent("edit", 0)],
        }),
        "observe",
      ),
    ).toBe("observe");
  });
});

describe("evaluateRules — first match wins", () => {
  it("returns the first matching rule's result, ignoring later rules", () => {
    const r1 = rule({
      rule_id: "first",
      applies_when: { action: "expired" },
      threshold: 1,
      result_if_met: "whitelist",
    });
    const r2 = rule({
      rule_id: "second",
      applies_when: { action: "expired" },
      threshold: 1,
      result_if_met: "blacklist",
    });
    const result = evaluateRules(
      [r1, r2],
      ctx({ recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("whitelist");
  });

  it("falls through to later rule when first does not match predicate", () => {
    const r1 = rule({
      applies_when: { action: "approve" }, // does not match (action is expired)
      result_if_met: "whitelist",
    });
    const r2 = rule({
      applies_when: { action: "expired" }, // matches
      threshold: 1,
      result_if_met: "blacklist",
    });
    const result = evaluateRules(
      [r1, r2],
      ctx({ recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("blacklist");
  });
});

describe("evaluateRules — active flag", () => {
  it("skips inactive rules", () => {
    const inactive = rule({ active: false, threshold: 1 });
    const result = evaluateRules(
      [inactive],
      ctx({ recentActions: [recent("expired", 0)] }),
      "observe",
    );
    expect(result).toBe("observe");
  });
});

describe("evaluateRules — recentActions filtering", () => {
  it("only counts recentActions matching the predicate", () => {
    const r = rule({
      applies_when: { action: "expired" },
      threshold: 2,
    });
    const result = evaluateRules(
      [r],
      ctx({
        recentActions: [
          recent("expired", 0.1),
          recent("approve", 0.2), // wrong action, skipped
          recent("expired", 0.3),
        ],
      }),
      "observe",
    );
    expect(result).toBe("blacklist"); // 2 expired events count
  });

  it("ignores events with unparseable timestamps", () => {
    const r = rule({ threshold: 2 });
    const result = evaluateRules(
      [r],
      ctx({
        recentActions: [
          { action: "expired", timestamp: "not-a-date" },
          recent("expired", 0.1),
          recent("expired", 0.2),
        ],
      }),
      "observe",
    );
    expect(result).toBe("blacklist"); // 2 valid events count
  });
});
