import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  ActionabilityDecision,
  ActionabilityDecisionsStore,
} from "@ai-feedback-middleware/core";
import { collect } from "./test-fixtures.js";

export interface ActionabilityDecisionsConformanceOptions {
  name: string;
  factory: () => Promise<ActionabilityDecisionsStore> | ActionabilityDecisionsStore;
  cleanup?: (adapter: ActionabilityDecisionsStore) => Promise<void> | void;
  skip?: boolean;
}

function decision(overrides: Partial<ActionabilityDecision> = {}): ActionabilityDecision {
  return {
    decision_id: "dec-1",
    rule_id: "rule-1",
    rule_version: "1",
    rule_run_at: "2026-04-24T00:00:00Z",
    artifact_id: "a-1",
    axis: "content",
    inference: "actionable_negative",
    evidence_event_ids: ["evt-1", "evt-2", "evt-3"],
    ...overrides,
  };
}

export function runActionabilityDecisionsConformance(
  options: ActionabilityDecisionsConformanceOptions,
): void {
  const suite = options.skip ? describe.skip : describe;

  suite(`ActionabilityDecisionsStore conformance: ${options.name}`, () => {
    let store: ActionabilityDecisionsStore;

    beforeEach(async () => {
      store = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(store);
    });

    it("appendBatch + read round-trip", async () => {
      await store.appendBatch([decision({ decision_id: "d1" })]);
      const all = await collect(store.read());
      expect(all.length).toBe(1);
      expect(all[0]!.decision_id).toBe("d1");
    });

    it("appendBatch with multiple rows preserves all", async () => {
      await store.appendBatch([
        decision({ decision_id: "d1" }),
        decision({ decision_id: "d2", axis: "timing" }),
        decision({ decision_id: "d3", axis: "channel" }),
      ]);
      const all = await collect(store.read());
      expect(all.length).toBe(3);
    });

    it("appendBatch is append-only — multiple calls accumulate", async () => {
      await store.appendBatch([decision({ decision_id: "d1" })]);
      await store.appendBatch([decision({ decision_id: "d2" })]);
      const all = await collect(store.read());
      expect(all.length).toBe(2);
    });

    it("read filters by axis", async () => {
      await store.appendBatch([
        decision({ decision_id: "d1", axis: "content" }),
        decision({ decision_id: "d2", axis: "timing" }),
        decision({ decision_id: "d3", axis: "content" }),
      ]);
      const filtered = await collect(store.read({ axis: "content" }));
      expect(filtered.map((d) => d.decision_id).sort()).toEqual(["d1", "d3"]);
    });

    it("read filters by inference", async () => {
      await store.appendBatch([
        decision({ decision_id: "d1", inference: "actionable_negative" }),
        decision({ decision_id: "d2", inference: "actionable_positive" }),
      ]);
      const negs = await collect(store.read({ inference: "actionable_negative" }));
      expect(negs.map((d) => d.decision_id)).toEqual(["d1"]);
    });

    it("read filters by rule_id", async () => {
      await store.appendBatch([
        decision({ decision_id: "d1", rule_id: "r1" }),
        decision({ decision_id: "d2", rule_id: "r2" }),
      ]);
      const r1 = await collect(store.read({ rule_id: "r1" }));
      expect(r1.map((d) => d.decision_id)).toEqual(["d1"]);
    });

    it("preserves evidence_event_ids array", async () => {
      const ids = ["e-1", "e-2", "e-3", "e-4", "e-5"];
      await store.appendBatch([decision({ decision_id: "d1", evidence_event_ids: ids })]);
      const [d] = await collect(store.read());
      expect(d!.evidence_event_ids).toEqual(ids);
    });
  });
}
