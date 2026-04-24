import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  type FeedbackEvent,
  type ProjectionBuilder,
  type EventStorePort,
  type ProjectionStorePort,
  type EventFilter,
} from "../src/index.js";

// Minimal in-memory adapters here so core can be tested standalone (no dep on @in-memory package).
function makeStore(): EventStorePort {
  const events: FeedbackEvent[] = [];
  return {
    async append(e) {
      events.push(e);
    },
    async appendBatch(b) {
      events.push(...b);
    },
    async *readStream(pk) {
      for (const e of events.filter((x) => x.partition_key === pk)) yield e;
    },
    async *readAll(filter?: EventFilter) {
      for (const e of events) {
        if (filter?.action && e.action !== filter.action) continue;
        if (filter?.polarity && e.polarity !== filter.polarity) continue;
        yield e;
      }
    },
    subscribeAll(_h) {
      return async () => {};
    },
  };
}

function makeProjectionStore(): ProjectionStorePort {
  const data = new Map<string, Map<string, unknown>>();
  const checkpoints = new Map<string, string>();
  function bucket(p: string): Map<string, unknown> {
    let m = data.get(p);
    if (!m) {
      m = new Map();
      data.set(p, m);
    }
    return m;
  }
  return {
    async get<T = unknown>(p: string, k: string): Promise<T | null> {
      return ((data.get(p)?.get(k) as T) ?? null) as T | null;
    },
    async put<T = unknown>(p: string, k: string, s: T, _e: string) {
      bucket(p).set(k, s);
    },
    async list<T = unknown>(p: string, _f: unknown, _ps: number): Promise<T[]> {
      return Array.from(data.get(p)?.values() ?? []) as T[];
    },
    async checkpoint(p: string) {
      return checkpoints.get(p) ?? null;
    },
    async setCheckpoint(p: string, e: string) {
      checkpoints.set(p, e);
    },
    async truncate(p: string) {
      data.delete(p);
      checkpoints.delete(p);
    },
  };
}

describe("createFeedback (end-to-end)", () => {
  it("captures an approve event with correct classification", async () => {
    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
    });

    const eventId = await feedback.capture({
      action: "approve",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "test-agent",
      task_type: "test_task",
      payload: { artifact_hash: "sha256:abc" },
    });

    expect(eventId).toBeTruthy();
    const events: FeedbackEvent[] = [];
    for await (const e of feedback.readStream("a-1")) events.push(e);
    expect(events.length).toBe(1);
    expect(events[0]!.action).toBe("approve");
    expect(events[0]!.polarity).toBe("positive");
    expect(events[0]!.inference).toBe("whitelist");
    expect(events[0]!.source).toBe("explicit");
  });

  it("captures an edit event with diff payload", async () => {
    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
    });

    await feedback.capture({
      action: "edit",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "test-agent",
      task_type: "test_task",
      payload: { original: "Dear John,\n\nI hope this finds you well.", corrected: "Hey John," },
    });

    const events: FeedbackEvent[] = [];
    for await (const e of feedback.readStream("a-1")) events.push(e);
    expect(events.length).toBe(1);
    expect(events[0]!.polarity).toBe("negative");
    expect(events[0]!.inference).toBe("blacklist");
    expect((events[0]!.payload as { original: string }).original).toContain("I hope this");
  });

  it("validates payload via the action's schema", async () => {
    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
    });

    await expect(
      feedback.capture({
        action: "edit",
        artifact_type: "draft",
        artifact_id: "a-1",
        artifact_version: 1,
        producer: "test-agent",
        task_type: "test_task",
        // missing required `original` and `corrected` fields
        payload: {},
      }),
    ).rejects.toThrow();
  });

  it("throws on unknown action", async () => {
    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
    });

    await expect(
      feedback.capture({
        action: "starred",
        artifact_type: "draft",
        artifact_id: "a-1",
        artifact_version: 1,
        producer: "t",
        task_type: "t",
        payload: {},
      }),
    ).rejects.toThrow(/Unknown action: starred/);
  });

  it("throws on unknown artifact type", async () => {
    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
    });

    await expect(
      feedback.capture({
        action: "approve",
        artifact_type: "search_result",
        artifact_id: "a-1",
        artifact_version: 1,
        producer: "t",
        task_type: "t",
        payload: {},
      }),
    ).rejects.toThrow(/Unknown artifact type/);
  });

  it("applies sync projections during capture", async () => {
    type CounterState = { count: number };
    const counter: ProjectionBuilder<CounterState> = {
      name: "approval_counter",
      mode: "sync",
      applies: (e) => e.action === "approve",
      apply: (_e, current) => ({ count: (current?.count ?? 0) + 1 }),
    };

    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      projections: [counter],
    });

    await feedback.capture({
      action: "approve",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "t",
      task_type: "t",
      payload: {},
    });
    await feedback.capture({
      action: "approve",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 2,
      producer: "t",
      task_type: "t",
      payload: {},
    });

    const counts = await feedback.queryProjection<CounterState>("approval_counter", undefined);
    expect(counts.length).toBe(1);
    expect(counts[0]!.count).toBe(2);
  });

  it("uses partition_key from input when provided", async () => {
    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjectionStore(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
    });

    await feedback.capture({
      action: "approve",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "t",
      task_type: "t",
      payload: {},
      partition_key: "tenant-foo:a-1",
    });

    const events: FeedbackEvent[] = [];
    for await (const e of feedback.readStream("tenant-foo:a-1")) events.push(e);
    expect(events.length).toBe(1);
  });

  it("supports custom action registration", async () => {
    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjectionStore(),
      actions: [
        ...DEFAULT_ACTIONS,
        {
          name: "starred",
          polarity: "positive",
          defaultInference: "whitelist",
          source: "explicit",
          payloadSchema: z.object({}),
        },
      ],
      artifactTypes: [{ name: "draft" }],
    });

    const id = await feedback.capture({
      action: "starred",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "t",
      task_type: "t",
      payload: {},
    });
    expect(id).toBeTruthy();
  });
});
