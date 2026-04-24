import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ActionRegistry } from "../src/registry/actions.js";
import { ArtifactTypeRegistry } from "../src/registry/artifact-types.js";
import { DEFAULT_ACTIONS } from "../src/registry/default-actions.js";

describe("ActionRegistry", () => {
  it("registers and retrieves actions", () => {
    const r = new ActionRegistry();
    r.register({
      name: "approve",
      polarity: "positive",
      defaultInference: "whitelist",
      source: "explicit",
      payloadSchema: z.object({}),
    });
    expect(r.has("approve")).toBe(true);
    expect(r.get("approve").polarity).toBe("positive");
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
      name: "approve",
      polarity: "positive",
      defaultInference: "whitelist",
      source: "explicit",
      payloadSchema: z.object({}),
    });
    expect(() =>
      r.register({
        name: "approve",
        polarity: "positive",
        defaultInference: "whitelist",
        source: "explicit",
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
    r.register({ name: "draft" });
    expect(r.has("draft")).toBe(true);
    expect(r.get("draft").name).toBe("draft");
  });

  it("throws on duplicate registration", () => {
    const r = new ArtifactTypeRegistry();
    r.register({ name: "draft" });
    expect(() => r.register({ name: "draft" })).toThrow(/already registered/);
  });

  it("throws with helpful message on unknown type", () => {
    const r = new ArtifactTypeRegistry([{ name: "draft" }, { name: "summary" }]);
    expect(() => r.get("transcription")).toThrow(/Unknown artifact type: transcription/);
    expect(() => r.get("transcription")).toThrow(/draft.*summary|summary.*draft/);
  });
});

describe("DEFAULT_ACTIONS", () => {
  it("contains the six framework defaults", () => {
    const names = DEFAULT_ACTIONS.map((a) => a.name).sort();
    expect(names).toEqual(["approve", "edit", "expired", "regenerate", "reject", "silent_accept"]);
  });

  it("each default has correct polarity", () => {
    const byName = Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.name, a]));
    expect(byName["approve"]!.polarity).toBe("positive");
    expect(byName["silent_accept"]!.polarity).toBe("positive");
    expect(byName["edit"]!.polarity).toBe("negative");
    expect(byName["reject"]!.polarity).toBe("negative");
    expect(byName["regenerate"]!.polarity).toBe("negative");
    expect(byName["expired"]!.polarity).toBe("negative");
  });

  it("each default has correct source", () => {
    const byName = Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.name, a]));
    expect(byName["approve"]!.source).toBe("explicit");
    expect(byName["edit"]!.source).toBe("explicit");
    expect(byName["reject"]!.source).toBe("explicit");
    expect(byName["regenerate"]!.source).toBe("explicit");
    expect(byName["expired"]!.source).toBe("implicit");
    expect(byName["silent_accept"]!.source).toBe("implicit");
  });
});
