import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { InferenceRulesPort, InferenceRule } from "@llm-feedback-middleware/core";

export interface InferenceRulesConformanceOptions {
  name: string;
  factory: () => Promise<InferenceRulesPort> | InferenceRulesPort;
  cleanup?: (adapter: InferenceRulesPort) => Promise<void> | void;
  skip?: boolean;
}

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

export function runInferenceRulesConformance(options: InferenceRulesConformanceOptions): void {
  const suite = options.skip ? describe.skip : describe;

  suite(`InferenceRulesPort conformance: ${options.name}`, () => {
    let store: InferenceRulesPort;

    beforeEach(async () => {
      store = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(store);
    });

    it("list returns empty when no rules registered", async () => {
      expect(await store.list()).toEqual([]);
    });

    it("upsert + list round-trip", async () => {
      await store.upsert(rule({ rule_id: "r1" }));
      const all = await store.list();
      expect(all.length).toBe(1);
      expect(all[0]!.rule_id).toBe("r1");
      expect(all[0]!.threshold).toBe(5);
    });

    it("upsert updates an existing rule by rule_id", async () => {
      await store.upsert(rule({ rule_id: "r1", threshold: 5 }));
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

    it("list excludes inactive rules", async () => {
      await store.upsert(rule({ rule_id: "active", active: true }));
      await store.upsert(rule({ rule_id: "inactive", active: false }));
      const all = await store.list();
      expect(all.length).toBe(1);
      expect(all[0]!.rule_id).toBe("active");
    });

    it("remove deletes a rule by id", async () => {
      await store.upsert(rule({ rule_id: "r1" }));
      await store.upsert(rule({ rule_id: "r2" }));
      await store.remove("r1");
      const remaining = await store.list();
      expect(remaining.map((r) => r.rule_id)).toEqual(["r2"]);
    });

    it("remove is idempotent on missing id", async () => {
      await store.remove("never-existed"); // should not throw
      expect(await store.list()).toEqual([]);
    });

    it("preserves predicate fields through round-trip", async () => {
      await store.upsert(
        rule({
          rule_id: "complex",
          applies_when: {
            action: "edit",
            task_type_prefix: "draft:",
            producer: "agent-x",
          },
        }),
      );
      const all = await store.list();
      expect(all[0]!.applies_when).toEqual({
        action: "edit",
        task_type_prefix: "draft:",
        producer: "agent-x",
      });
    });

    it("preserves window_ms with bigint-range values", async () => {
      // 365 days in ms = 31_536_000_000 — still well within Number.MAX_SAFE_INTEGER
      // but exercises bigint handling on the postgres side.
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      await store.upsert(rule({ rule_id: "yearly", window_ms: yearMs }));
      const all = await store.list();
      expect(all[0]!.window_ms).toBe(yearMs);
    });
  });
}
