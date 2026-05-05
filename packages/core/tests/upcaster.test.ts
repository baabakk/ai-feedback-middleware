import { describe, it, expect } from "vitest";
import {
  type EventUpcaster,
  type FeedbackEvent,
  upcastEvent,
  upcastStream,
  validateUpcasterChain,
} from "../src/index.js";

function makeEvent(version: number, overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    event_id: "e1",
    event_version: version,
    timestamp: "2026-04-24T00:00:00Z",
    captured_at: "2026-04-24T00:00:00Z",
    partition_key: "p-1",
    source: "explicit",
    polarity: "positive",
    inference: "whitelist",
    action: "approve",
    artifact_type: "draft",
    artifact_id: "p-1",
    artifact_version: 1,
    producer: "test",
    task_type: "test",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

describe("validateUpcasterChain", () => {
  it("accepts an empty chain at currentSchemaVersion 1", () => {
    expect(() => validateUpcasterChain([], 1)).not.toThrow();
  });

  it("rejects upcasters when currentSchemaVersion is 1", () => {
    const u: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e };
    expect(() => validateUpcasterChain([u], 1)).toThrow(/currentSchemaVersion is 1/);
  });

  it("accepts a contiguous chain v1 -> v2 -> v3", () => {
    const u1: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e };
    const u2: EventUpcaster = { fromVersion: 2, toVersion: 3, upcast: (e) => e };
    expect(() => validateUpcasterChain([u1, u2], 3)).not.toThrow();
  });

  it("accepts chain registered out of order (sorted internally)", () => {
    const u1: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e };
    const u2: EventUpcaster = { fromVersion: 2, toVersion: 3, upcast: (e) => e };
    expect(() => validateUpcasterChain([u2, u1], 3)).not.toThrow();
  });

  it("rejects gap in chain (caught by positional check)", () => {
    const u1: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e };
    // missing v2 -> v3; chain too short positionally
    const u3: EventUpcaster = { fromVersion: 3, toVersion: 4, upcast: (e) => e };
    // Validator scans positionally: position 1 should be v2->v3 but is v3->v4.
    expect(() => validateUpcasterChain([u1, u3], 4)).toThrow(
      /Expected upcaster v2->v3, got v3->v4/,
    );
  });

  it("rejects truly missing upcaster (chain too short)", () => {
    const u1: EventUpcaster = { fromVersion: 1, toVersion: 2, upcast: (e) => e };
    // chain has only one upcaster but currentSchemaVersion is 4
    expect(() => validateUpcasterChain([u1], 4)).toThrow(/Missing upcaster from v2 to v3/);
  });

  it("rejects upcaster that skips versions", () => {
    const bad: EventUpcaster = { fromVersion: 1, toVersion: 3, upcast: (e) => e };
    expect(() => validateUpcasterChain([bad], 3)).toThrow(/Expected upcaster v1->v2/);
  });

  it("rejects currentSchemaVersion < 1", () => {
    expect(() => validateUpcasterChain([], 0)).toThrow(/must be >= 1/);
  });
});

describe("upcastEvent", () => {
  it("passes through events already at currentSchemaVersion", () => {
    const e = makeEvent(2);
    const result = upcastEvent(e, [], 2);
    expect(result).toBe(e);
  });

  it("applies a single upcaster v1 -> v2", () => {
    const u: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: (event) => ({
        ...event,
        event_version: 2,
        payload: { ...(event.payload as object), upcasted: true },
      }),
    };
    const e = makeEvent(1);
    const result = upcastEvent(e, [u], 2);
    expect(result.event_version).toBe(2);
    expect((result.payload as { upcasted?: boolean }).upcasted).toBe(true);
  });

  it("chains multiple upcasters v1 -> v2 -> v3", () => {
    const u1: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: (e) => ({
        ...e,
        event_version: 2,
        payload: { ...(e.payload as object), step: "v2" },
      }),
    };
    const u2: EventUpcaster = {
      fromVersion: 2,
      toVersion: 3,
      upcast: (e) => ({
        ...e,
        event_version: 3,
        payload: { ...(e.payload as object), step: "v3" },
      }),
    };
    const e = makeEvent(1);
    const result = upcastEvent(e, [u1, u2], 3);
    expect(result.event_version).toBe(3);
    expect((result.payload as { step: string }).step).toBe("v3");
  });

  it("starts at the event's version (not always at v1)", () => {
    const u1: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: () => {
        throw new Error("should not run for v2 events");
      },
    };
    const u2: EventUpcaster = {
      fromVersion: 2,
      toVersion: 3,
      upcast: (e) => ({ ...e, event_version: 3 }),
    };
    const e = makeEvent(2);
    const result = upcastEvent(e, [u1, u2], 3);
    expect(result.event_version).toBe(3);
  });

  it("throws when reader's currentSchemaVersion is older than event's", () => {
    const e = makeEvent(3);
    expect(() => upcastEvent(e, [], 2)).toThrow(/Cannot read event/);
  });

  it("throws when an upcaster fails to bump event_version", () => {
    const buggy: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      // forgot to update event_version
      upcast: (e) => e,
    };
    const e = makeEvent(1);
    expect(() => upcastEvent(e, [buggy], 2)).toThrow(/did not update event_version/);
  });
});

describe("upcastStream", () => {
  async function* gen(events: FeedbackEvent[]): AsyncIterable<FeedbackEvent> {
    for (const e of events) yield e;
  }

  async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const v of iter) out.push(v);
    return out;
  }

  it("upcasts every event in the stream", async () => {
    const u: EventUpcaster = {
      fromVersion: 1,
      toVersion: 2,
      upcast: (e) => ({ ...e, event_version: 2 }),
    };
    const events = [makeEvent(1, { event_id: "a" }), makeEvent(1, { event_id: "b" })];
    const result = await collect(upcastStream(gen(events), [u], 2));
    expect(result.every((e) => e.event_version === 2)).toBe(true);
  });

  it("passes through current-version events unchanged", async () => {
    const events = [makeEvent(2, { event_id: "a" }), makeEvent(2, { event_id: "b" })];
    const result = await collect(upcastStream(gen(events), [], 2));
    expect(result.length).toBe(2);
    expect(result.every((e) => e.event_version === 2)).toBe(true);
  });
});
