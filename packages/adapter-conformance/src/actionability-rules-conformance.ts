import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ActionabilityRule, ActionabilityRulesPort } from "@ai-feedback-middleware/core";

export interface ActionabilityRulesConformanceOptions {
  name: string;
  factory: () => Promise<ActionabilityRulesPort> | ActionabilityRulesPort;
  cleanup?: (adapter: ActionabilityRulesPort) => Promise<void> | void;
  skip?: boolean;
}

function rule(overrides: Partial<ActionabilityRule> = {}): ActionabilityRule {
  return {
    rule_id: "test_rule",
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

export function runActionabilityRulesConformance(
  options: ActionabilityRulesConformanceOptions,
): void {
  const suite = options.skip ? describe.skip : describe;

  suite(`ActionabilityRulesPort conformance: ${options.name}`, () => {
    let store: ActionabilityRulesPort;

    beforeEach(async () => {
      store = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(store);
    });

    it("list returns empty when no rules registered", async () => {
      expect(await store.list()).toEqual([]);
    });

    it("upsert + list round-trip preserves all fields", async () => {
      await store.upsert(rule({ rule_id: "r1" }));
      const all = await store.list();
      expect(all.length).toBe(1);
      const r = all[0]!;
      expect(r.rule_id).toBe("r1");
      expect(r.rule_version).toBe("1");
      expect(r.axis).toBe("content");
      expect(r.threshold).toBe(3);
      expect(r.window_ms).toBe(60_000);
      expect(r.result_if_met).toBe("actionable_negative");
      expect(r.active).toBe(true);
    });

    it("upsert updates an existing rule by rule_id", async () => {
      await store.upsert(rule({ rule_id: "r1", threshold: 3 }));
      await store.upsert(rule({ rule_id: "r1", threshold: 10 }));
      const all = await store.list();
      expect(all.length).toBe(1);
      expect(all[0]!.threshold).toBe(10);
    });

    it("list returns multiple rules", async () => {
      await store.upsert(rule({ rule_id: "a" }));
      await store.upsert(rule({ rule_id: "b" }));
      await store.upsert(rule({ rule_id: "c" }));
      const all = await store.list();
      const ids = all.map((r) => r.rule_id).sort();
      expect(ids).toEqual(["a", "b", "c"]);
    });

    it("list returns inactive rules too (engine filters by `active` itself)", async () => {
      await store.upsert(rule({ rule_id: "active", active: true }));
      await store.upsert(rule({ rule_id: "inactive", active: false }));
      const all = await store.list();
      expect(all.length).toBe(2);
    });

    it("remove deletes a rule by id", async () => {
      await store.upsert(rule({ rule_id: "r1" }));
      await store.upsert(rule({ rule_id: "r2" }));
      await store.remove("r1");
      const remaining = await store.list();
      expect(remaining.map((r) => r.rule_id)).toEqual(["r2"]);
    });

    it("remove is idempotent on missing id", async () => {
      await store.remove("never-existed");
      expect(await store.list()).toEqual([]);
    });

    it("preserves predicate fields through round-trip", async () => {
      await store.upsert(
        rule({
          rule_id: "complex",
          applies_when: {
            action: "manually_edited",
            task_type_prefix: "draft:",
            producer: "agent-x",
            artifact_type: "draft_email",
          },
        }),
      );
      const all = await store.list();
      expect(all[0]!.applies_when).toEqual({
        action: "manually_edited",
        task_type_prefix: "draft:",
        producer: "agent-x",
        artifact_type: "draft_email",
      });
    });

    it("preserves window_ms for year-scale values", async () => {
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      await store.upsert(rule({ rule_id: "yearly", window_ms: yearMs }));
      const all = await store.list();
      expect(all[0]!.window_ms).toBe(yearMs);
    });

    it("preserves all four axis values", async () => {
      for (const axis of ["detection", "content", "timing", "channel"] as const) {
        await store.upsert(rule({ rule_id: `r-${axis}`, axis }));
      }
      const all = await store.list();
      const axes = all.map((r) => r.axis).sort();
      expect(axes).toEqual(["channel", "content", "detection", "timing"]);
    });
  });
}

/**
 * @deprecated Use {@link runActionabilityRulesConformance}. v1 alias retained
 * for adapter packages still on the older test name.
 */
export const runInferenceRulesConformance = runActionabilityRulesConformance;
export type InferenceRulesConformanceOptions = ActionabilityRulesConformanceOptions;
