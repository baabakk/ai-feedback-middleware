import { describe, it, expect } from "vitest";
import { evaluateReaction, type ClassifierContext } from "../src/classifier.js";
import { DEFAULT_ACTIONS } from "../src/registry/default-actions.js";

const byName = Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.name, a]));
const ctx: ClassifierContext = { classifier_version: "test-2.1" };

describe("evaluateReaction (Layer 3 — Reaction Evaluation)", () => {
  it("approved sets all four axes positive", () => {
    expect(evaluateReaction(byName["approved"]!, {}, ctx)).toEqual({
      detection: "positive",
      content: "positive",
      timing: "positive",
      channel: "positive",
    });
  });

  it("manually_edited: detection/timing/channel positive, content negative", () => {
    expect(
      evaluateReaction(byName["manually_edited"]!, { original: "hi", corrected: "hello" }, ctx),
    ).toEqual({
      detection: "positive",
      content: "negative",
      timing: "positive",
      channel: "positive",
    });
  });

  it("rejected leaves detection axis empty (one rejection cannot disambiguate trigger vs version)", () => {
    expect(evaluateReaction(byName["rejected"]!, {}, ctx)).toEqual({
      content: "negative",
    });
  });

  it("regenerated: trigger right, content wrong", () => {
    expect(evaluateReaction(byName["regenerated"]!, {}, ctx)).toEqual({
      detection: "positive",
      content: "negative",
      timing: "positive",
      channel: "positive",
    });
  });

  it("not_selected_from_list: detection confirmed by selecting something in the set", () => {
    expect(
      evaluateReaction(
        byName["not_selected_from_list"]!,
        { competitors: ["a", "b"], chosen: "b" },
        ctx,
      ),
    ).toEqual({
      detection: "positive",
      content: "negative",
    });
  });

  it("mute_triggered: timing/channel as candidate causes; detection and content empty", () => {
    expect(evaluateReaction(byName["mute_triggered"]!, {}, ctx)).toEqual({
      timing: "negative",
      channel: "negative",
    });
  });

  it("silently_accepted: detection + content positive, timing/channel empty", () => {
    expect(evaluateReaction(byName["silently_accepted"]!, {}, ctx)).toEqual({
      detection: "positive",
      content: "positive",
    });
  });

  it("silently_rejected_expired: empty per-axis evidence (aggregate-negative is policy-driven)", () => {
    expect(evaluateReaction(byName["silently_rejected_expired"]!, {}, ctx)).toEqual({});
  });

  it("internally_unobserved_externally_completed: pure detection failure", () => {
    expect(
      evaluateReaction(byName["internally_unobserved_externally_completed"]!, {}, ctx),
    ).toEqual({ detection: "negative" });
  });

  it("manually_replaced: detection right, content wrong", () => {
    expect(evaluateReaction(byName["manually_replaced"]!, { replacement: "x" }, ctx)).toEqual({
      detection: "positive",
      content: "negative",
    });
  });

  it("tombstones (corrected/cancelled/superseded_by) carry empty evaluations", () => {
    expect(evaluateReaction(byName["corrected"]!, { reason: "race" }, ctx)).toEqual({});
    expect(evaluateReaction(byName["cancelled"]!, { reason: "duplicate" }, ctx)).toEqual({});
    expect(evaluateReaction(byName["superseded_by"]!, {}, ctx)).toEqual({});
  });

  it("is deterministic: same inputs produce same outputs", () => {
    const r1 = evaluateReaction(byName["approved"]!, {}, ctx);
    const r2 = evaluateReaction(byName["approved"]!, {}, ctx);
    expect(r1).toEqual(r2);
  });

  it("override replaces a single axis without disturbing others", () => {
    const r = evaluateReaction(byName["approved"]!, {}, ctx, { channel: "negative" });
    expect(r).toEqual({
      detection: "positive",
      content: "positive",
      timing: "positive",
      channel: "negative",
    });
  });

  it("override may add an axis the action did not set", () => {
    const r = evaluateReaction(byName["rejected"]!, {}, ctx, {
      detection: "negative",
      timing: "negative",
    });
    expect(r).toEqual({
      detection: "negative",
      content: "negative",
      timing: "negative",
    });
  });

  it("undefined override keeps the action's defaults", () => {
    const r = evaluateReaction(byName["approved"]!, {}, ctx, undefined);
    expect(r).toEqual({
      detection: "positive",
      content: "positive",
      timing: "positive",
      channel: "positive",
    });
  });
});
