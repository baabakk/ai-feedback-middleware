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

  it("ignores recentActions context in F0 (rules engine ships in F2)", () => {
    const ctxWithMany = {
      recentActions: [
        { action: "expired", timestamp: "2026-04-01T00:00:00Z" },
        { action: "expired", timestamp: "2026-04-02T00:00:00Z" },
        { action: "expired", timestamp: "2026-04-03T00:00:00Z" },
        { action: "expired", timestamp: "2026-04-04T00:00:00Z" },
        { action: "expired", timestamp: "2026-04-05T00:00:00Z" },
      ],
    };
    const result = classify(byName["expired"]!, {}, ctxWithMany);
    // F0 returns default; F2 will return blacklist after 5 expires
    expect(result.inference).toBe("observe");
  });
});
