import { describe, it, expect, beforeEach } from "vitest";
import { ProjectionEngine, type ProjectionBuilder } from "../src/projection-engine.js";
import type { ProjectionStorePort } from "../src/ports/projection-store-port.js";
import type { FeedbackEvent } from "../src/event-types.js";

class FakeStore implements ProjectionStorePort {
  state = new Map<string, Map<string, unknown>>();
  checkpoints = new Map<string, string>();

  async get<T = unknown>(p: string, k: string): Promise<T | null> {
    return ((this.state.get(p)?.get(k) as T) ?? null) as T | null;
  }
  async put<T = unknown>(p: string, k: string, s: T, _eid: string): Promise<void> {
    if (!this.state.has(p)) this.state.set(p, new Map());
    this.state.get(p)!.set(k, s);
  }
  async list<T = unknown>(p: string, _f: unknown, _ps: number): Promise<T[]> {
    return Array.from(this.state.get(p)?.values() ?? []) as T[];
  }
  async checkpoint(p: string): Promise<string | null> {
    return this.checkpoints.get(p) ?? null;
  }
  async setCheckpoint(p: string, eid: string): Promise<void> {
    this.checkpoints.set(p, eid);
  }
  async truncate(p: string): Promise<void> {
    this.state.delete(p);
    this.checkpoints.delete(p);
  }
}

function makeEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    event_id: "evt-1",
    event_version: 1,
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
    task_type: "test_task",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

const counterBuilder: ProjectionBuilder<{ count: number }> = {
  name: "approval_counter",
  mode: "sync",
  applies: (e) => e.action === "approve",
  apply: (_event, current) => ({ count: (current?.count ?? 0) + 1 }),
};

const negativeAsyncBuilder: ProjectionBuilder<{ count: number }> = {
  name: "negative_counter",
  mode: "async",
  applies: (e) => e.polarity === "negative",
  apply: (_event, current) => ({ count: (current?.count ?? 0) + 1 }),
};

describe("ProjectionEngine", () => {
  let store: FakeStore;
  let engine: ProjectionEngine;

  beforeEach(() => {
    store = new FakeStore();
    engine = new ProjectionEngine(store, [counterBuilder, negativeAsyncBuilder]);
  });

  it("applies sync builders to matching events", async () => {
    await engine.applySync(makeEvent({ event_id: "e1", action: "approve" }));
    await engine.applySync(makeEvent({ event_id: "e2", action: "approve" }));
    await engine.applySync(
      makeEvent({ event_id: "e3", action: "edit", polarity: "negative", inference: "blacklist" }),
    );

    const counter = await store.get<{ count: number }>("approval_counter", "p-1");
    expect(counter?.count).toBe(2);
  });

  it("does not apply async builders during applySync", async () => {
    await engine.applySync(
      makeEvent({ action: "edit", polarity: "negative", inference: "blacklist" }),
    );
    const negCounter = await store.get<{ count: number }>("negative_counter", "p-1");
    expect(negCounter).toBeNull();
  });

  it("applies async builders during applyAsync", async () => {
    await engine.applyAsync(
      makeEvent({ action: "edit", polarity: "negative", inference: "blacklist" }),
    );
    const negCounter = await store.get<{ count: number }>("negative_counter", "p-1");
    expect(negCounter?.count).toBe(1);
  });

  it("respects builder.applies() filter", async () => {
    await engine.applySync(
      makeEvent({ action: "edit", polarity: "negative", inference: "blacklist" }),
    );
    const counter = await store.get<{ count: number }>("approval_counter", "p-1");
    expect(counter).toBeNull();
  });

  it("uses keyFor when provided", async () => {
    const customKeyBuilder: ProjectionBuilder<{ count: number }> = {
      name: "by_producer",
      mode: "sync",
      applies: () => true,
      keyFor: (e) => e.producer,
      apply: (_event, current) => ({ count: (current?.count ?? 0) + 1 }),
    };
    const e = new ProjectionEngine(store, [customKeyBuilder]);
    await e.applySync(makeEvent({ producer: "agent-a" }));
    await e.applySync(makeEvent({ producer: "agent-a" }));
    await e.applySync(makeEvent({ producer: "agent-b" }));

    expect((await store.get<{ count: number }>("by_producer", "agent-a"))?.count).toBe(2);
    expect((await store.get<{ count: number }>("by_producer", "agent-b"))?.count).toBe(1);
  });

  it("rebuild truncates and replays", async () => {
    await engine.applySync(makeEvent({ event_id: "e1" }));
    await engine.applySync(makeEvent({ event_id: "e2" }));
    expect((await store.get<{ count: number }>("approval_counter", "p-1"))?.count).toBe(2);

    async function* events(): AsyncIterable<FeedbackEvent> {
      yield makeEvent({ event_id: "r1" });
      yield makeEvent({ event_id: "r2" });
      yield makeEvent({ event_id: "r3" });
    }

    const result = await engine.rebuild("approval_counter", events());
    expect(result.eventsProcessed).toBe(3);
    expect((await store.get<{ count: number }>("approval_counter", "p-1"))?.count).toBe(3);
    expect(await store.checkpoint("approval_counter")).toBe("r3");
  });

  it("throws on unknown projection name", () => {
    expect(() => engine.builderByName("nonexistent")).toThrow(/Unknown projection/);
  });

  it("lists all builder names", () => {
    expect(engine.builderNames().sort()).toEqual(["approval_counter", "negative_counter"]);
  });
});
