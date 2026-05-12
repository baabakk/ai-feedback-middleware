import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ActionRegistry } from "../src/registry/actions.js";
import {
  ArtifactTypeRegistry,
  acceptByDefault,
  rejectByDefault,
} from "../src/registry/artifact-types.js";
import { DEFAULT_ACTIONS } from "../src/registry/default-actions.js";

describe("ActionRegistry", () => {
  it("registers and retrieves actions", () => {
    const r = new ActionRegistry();
    r.register({
      name: "approved",
      source: "explicit",
      defaultEvaluations: {
        detection: "positive",
        content: "positive",
        timing: "positive",
        channel: "positive",
      },
      payloadSchema: z.object({}),
    });
    expect(r.has("approved")).toBe(true);
    expect(r.get("approved").defaultEvaluations.content).toBe("positive");
  });

  it("constructs from a list", () => {
    const r = new ActionRegistry(DEFAULT_ACTIONS);
    expect(r.list().length).toBe(DEFAULT_ACTIONS.length);
    for (const action of DEFAULT_ACTIONS) {
      expect(r.has(action.name)).toBe(true);
    }
  });

  it("throws on duplicate registration", () => {
    const r = new ActionRegistry();
    r.register({
      name: "approved",
      source: "explicit",
      defaultEvaluations: { content: "positive" },
      payloadSchema: z.object({}),
    });
    expect(() =>
      r.register({
        name: "approved",
        source: "explicit",
        defaultEvaluations: { content: "positive" },
        payloadSchema: z.object({}),
      }),
    ).toThrow(/already registered/);
  });

  it("throws with a helpful message on unknown action", () => {
    const r = new ActionRegistry(DEFAULT_ACTIONS);
    expect(() => r.get("starred")).toThrow(/Unknown action: starred/);
    expect(() => r.get("starred")).toThrow(/Registered actions/);
  });
});

describe("ArtifactTypeRegistry", () => {
  it("registers and retrieves types", () => {
    const r = new ArtifactTypeRegistry();
    r.register(rejectByDefault("draft_email"));
    expect(r.has("draft_email")).toBe(true);
    expect(r.get("draft_email").name).toBe("draft_email");
    expect(r.get("draft_email").expirationPolicy).toBe("rejected_by_default");
  });

  it("throws on duplicate registration", () => {
    const r = new ArtifactTypeRegistry();
    r.register(rejectByDefault("draft_email"));
    expect(() => r.register(rejectByDefault("draft_email"))).toThrow(/already registered/);
  });

  it("throws with helpful message on unknown type", () => {
    const r = new ArtifactTypeRegistry([
      rejectByDefault("draft_email"),
      acceptByDefault("morning_briefing"),
    ]);
    expect(() => r.get("transcription")).toThrow(/Unknown artifact type: transcription/);
    expect(() => r.get("transcription")).toThrow(
      /draft_email.*morning_briefing|morning_briefing.*draft_email/,
    );
  });

  it("rejects registration without expirationPolicy", () => {
    const r = new ArtifactTypeRegistry();
    expect(() => r.register({ name: "ill-formed" } as never)).toThrow(/expirationPolicy/);
  });
});

describe("DEFAULT_ACTIONS", () => {
  it("contains the thirteen framework-locked actions", () => {
    const names = DEFAULT_ACTIONS.map((a) => a.name).sort();
    expect(names).toEqual(
      [
        "approved",
        "cancelled",
        "corrected",
        "internally_unobserved_externally_completed",
        "manually_edited",
        "manually_replaced",
        "mute_triggered",
        "not_selected_from_list",
        "regenerated",
        "rejected",
        "silently_accepted",
        "silently_rejected_expired",
        "superseded_by",
      ].sort(),
    );
  });

  it("explicit actions are tagged source='explicit'", () => {
    const byName = Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.name, a]));
    for (const name of [
      "approved",
      "manually_edited",
      "rejected",
      "regenerated",
      "not_selected_from_list",
      "mute_triggered",
    ]) {
      expect(byName[name]!.source).toBe("explicit");
    }
  });

  it("implicit actions are tagged source='implicit'", () => {
    const byName = Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.name, a]));
    for (const name of [
      "silently_accepted",
      "silently_rejected_expired",
      "internally_unobserved_externally_completed",
      "manually_replaced",
    ]) {
      expect(byName[name]!.source).toBe("implicit");
    }
  });

  it("tombstone actions are tagged source='meta' with empty default evaluations", () => {
    const byName = Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.name, a]));
    for (const name of ["corrected", "cancelled", "superseded_by"]) {
      expect(byName[name]!.source).toBe("meta");
      expect(byName[name]!.defaultEvaluations).toEqual({});
    }
  });

  it("rejected leaves the detection axis empty by default", () => {
    const byName = Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.name, a]));
    expect(byName["rejected"]!.defaultEvaluations.detection).toBeUndefined();
    expect(byName["rejected"]!.defaultEvaluations.content).toBe("negative");
  });
});
