import { describe, it, expect, beforeEach } from "vitest";
import { ProjectionEngine, type ProjectionBuilder } from "../src/projection-engine.js";
import type { ProjectionStorePort } from "../src/ports/projection-store-port.js";
import type {
  CapturedArtifactEvent,
  CapturedEvaluatedReactionEvent,
  FeedbackEvent,
} from "../src/event-types.js";

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

function makeCapture(overrides: Partial<CapturedArtifactEvent> = {}): CapturedArtifactEvent {
  return {
    event_kind: "capture",
    event_id: "evt-1",
    event_version: 2,
    artifact_id: "p-1",
    artifact_type: "draft_email",
    artifact_version: 1,
    partition_key: "p-1",
    producer: "test",
    task_type: "test_task",
    expires_at: "2026-04-25T00:00:00Z",
    occurred_at: "2026-04-24T00:00:00Z",
    captured_at: "2026-04-24T00:00:00Z",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

function makeReaction(
  overrides: Partial<CapturedEvaluatedReactionEvent> = {},
): CapturedEvaluatedReactionEvent {
  return {
    event_kind: "reaction",
    event_id: "evt-r1",
    event_version: 2,
    artifact_id: "p-1",
    artifact_type: "draft_email",
    artifact_version: 1,
    partition_key: "p-1",
    producer: "test",
    task_type: "test_task",
    source: "explicit",
    action: "approved",
    evaluations: {
      detection: "positive",
      content: "positive",
      timing: "positive",
      channel: "positive",
    },
    classifier_version: "test-2.1",
    occurred_at: "2026-04-24T00:00:00Z",
    captured_at: "2026-04-24T00:00:00Z",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

const approvedCounterBuilder: ProjectionBuilder<{ count: number }> = {
  name: "approval_counter",
  mode: "sync",
  applies: (e) => e.event_kind === "reaction" && e.action === "approved",
  apply: (_event, current) => ({ count: (current?.count ?? 0) + 1 }),
};

const contentNegativeAsyncBuilder: ProjectionBuilder<{ count: number }> = {
  name: "content_negative_counter",
  mode: "async",
  applies: (e) => e.event_kind === "reaction" && e.evaluations.content === "negative",
  apply: (_event, current) => ({ count: (current?.count ?? 0) + 1 }),
};

describe("ProjectionEngine", () => {
  let store: FakeStore;
  let engine: ProjectionEngine;

  beforeEach(() => {
    store = new FakeStore();
    engine = new ProjectionEngine(store, [approvedCounterBuilder, contentNegativeAsyncBuilder]);
  });

  it("applies sync builders to matching events", async () => {
    await engine.applySync(makeReaction({ event_id: "e1", action: "approved" }));
    await engine.applySync(makeReaction({ event_id: "e2", action: "approved" }));
    await engine.applySync(
      makeReaction({
        event_id: "e3",
        action: "manually_edited",
        evaluations: { content: "negative" },
      }),
    );

    const counter = await store.get<{ count: number }>("approval_counter", "p-1");
    expect(counter?.count).toBe(2);
  });

  it("does not apply async builders during applySync", async () => {
    await engine.applySync(
      makeReaction({
        action: "rejected",
        evaluations: { content: "negative" },
      }),
    );
    const negCounter = await store.get<{ count: number }>("content_negative_counter", "p-1");
    expect(negCounter).toBeNull();
  });

  it("applies async builders during applyAsync", async () => {
    await engine.applyAsync(
      makeReaction({
        action: "rejected",
        evaluations: { content: "negative" },
      }),
    );
    const negCounter = await store.get<{ count: number }>("content_negative_counter", "p-1");
    expect(negCounter?.count).toBe(1);
  });

  it("ignores capture events when builders are scoped to reactions", async () => {
    await engine.applySync(makeCapture());
    expect(await store.get("approval_counter", "p-1")).toBeNull();
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
    await e.applySync(makeReaction({ producer: "agent-a" }));
    await e.applySync(makeReaction({ producer: "agent-a" }));
    await e.applySync(makeReaction({ producer: "agent-b" }));

    expect((await store.get<{ count: number }>("by_producer", "agent-a"))?.count).toBe(2);
    expect((await store.get<{ count: number }>("by_producer", "agent-b"))?.count).toBe(1);
  });

  it("rebuild truncates and replays", async () => {
    await engine.applySync(makeReaction({ event_id: "e1" }));
    await engine.applySync(makeReaction({ event_id: "e2" }));
    expect((await store.get<{ count: number }>("approval_counter", "p-1"))?.count).toBe(2);

    async function* events(): AsyncIterable<FeedbackEvent> {
      yield makeReaction({ event_id: "r1" });
      yield makeReaction({ event_id: "r2" });
      yield makeReaction({ event_id: "r3" });
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
    expect(engine.builderNames().sort()).toEqual(["approval_counter", "content_negative_counter"]);
  });
});
