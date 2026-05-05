import { describe, it, expect } from "vitest";
import { classify } from "../src/classifier.js";
import { DEFAULT_ACTIONS } from "../src/registry/default-actions.js";

const byName = Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.name, a]));

describe("classifier (F0: returns action defaults)", () => {
  it("classifies approve as positive whitelist", () => {
    const result = classify(byName["approve"]!, {});
    expect(result.polarity).toBe("positive");
    expect(result.inference).toBe("whitelist");
  });

  it("classifies edit as negative blacklist", () => {
    const result = classify(byName["edit"]!, { original: "hi", corrected: "hello" });
    expect(result.polarity).toBe("negative");
    expect(result.inference).toBe("blacklist");
  });

  it("classifies reject as negative blacklist", () => {
    const result = classify(byName["reject"]!, {});
    expect(result.polarity).toBe("negative");
    expect(result.inference).toBe("blacklist");
  });

  it("classifies regenerate as negative observe", () => {
    const result = classify(byName["regenerate"]!, {});
    expect(result.polarity).toBe("negative");
    expect(result.inference).toBe("observe");
  });

  it("classifies expired as negative observe", () => {
    const result = classify(byName["expired"]!, {});
    expect(result.polarity).toBe("negative");
    expect(result.inference).toBe("observe");
  });

  it("classifies silent_accept as positive observe", () => {
    const result = classify(byName["silent_accept"]!, {});
    expect(result.polarity).toBe("positive");
    expect(result.inference).toBe("observe");
  });

  it("is deterministic: same inputs produce same outputs", () => {
    const r1 = classify(byName["approve"]!, {});
    const r2 = classify(byName["approve"]!, {});
    expect(r1).toEqual(r2);
  });

  it("returns the action's defaultInference when no rules are registered", () => {
    const result = classify(
      byName["expired"]!,
      {},
      {
        task_type: "test",
        producer: "test",
        artifact_type: "draft",
        history: [
          { action: "expired", timestamp: "2026-04-01T00:00:00Z" },
          { action: "expired", timestamp: "2026-04-02T00:00:00Z" },
        ],
        // No rules registered, so history is ignored.
      },
    );
    expect(result.inference).toBe("observe");
  });

  it("applies a registered rule: 5 expires within 7 days -> blacklist", () => {
    const now = "2026-04-10T00:00:00Z";
    const result = classify(
      byName["expired"]!,
      {},
      {
        task_type: "draft:email",
        producer: "agent",
        artifact_type: "draft",
        now,
        rules: [
          {
            rule_id: "expired_to_blacklist",
            applies_when: { action: "expired" },
            threshold: 5,
            window_ms: 7 * 24 * 60 * 60 * 1000,
            result_if_met: "blacklist",
            active: true,
          },
        ],
        history: [
          { action: "expired", timestamp: "2026-04-08T00:00:00Z" },
          { action: "expired", timestamp: "2026-04-09T00:00:00Z" },
          { action: "expired", timestamp: "2026-04-09T06:00:00Z" },
          { action: "expired", timestamp: "2026-04-09T12:00:00Z" },
          { action: "expired", timestamp: "2026-04-09T18:00:00Z" },
        ],
      },
    );
    expect(result.inference).toBe("blacklist");
  });

  it("rule fires only when history meets threshold", () => {
    const now = "2026-04-10T00:00:00Z";
    const result = classify(
      byName["expired"]!,
      {},
      {
        task_type: "draft:email",
        producer: "agent",
        artifact_type: "draft",
        now,
        rules: [
          {
            rule_id: "expired_to_blacklist",
            applies_when: { action: "expired" },
            threshold: 5,
            window_ms: 7 * 24 * 60 * 60 * 1000,
            result_if_met: "blacklist",
            active: true,
          },
        ],
        history: [
          // Only 2 within the window — not enough.
          { action: "expired", timestamp: "2026-04-09T00:00:00Z" },
          { action: "expired", timestamp: "2026-04-09T12:00:00Z" },
        ],
      },
    );
    expect(result.inference).toBe("observe");
  });
});
