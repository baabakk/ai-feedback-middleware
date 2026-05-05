import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  type EventBusPort,
  type FeedbackEvent,
  type EventStorePort,
  type ProjectionStorePort,
  type EventFilter,
} from "../src/index.js";

function makeStore(): EventStorePort {
  const events: FeedbackEvent[] = [];
  return {
    async withTransaction(work) {
      return work(undefined);
    },
    async append(e) {
      events.push(e);
    },
    async appendBatch(b) {
      events.push(...b);
    },
    async *readStream(pk) {
      for (const e of events.filter((x) => x.partition_key === pk)) yield e;
    },
    async *readStreamSince(pk, since) {
      const cutoff = Date.parse(since);
      for (const e of events.filter((x) => x.partition_key === pk)) {
        const t = Date.parse(e.timestamp);
        if (!Number.isNaN(t) && t >= cutoff) yield e;
      }
    },
    async *readAll(_filter?: EventFilter) {
      for (const e of events) yield e;
    },
    subscribeAll(_h) {
      return async () => {};
    },
  };
}

function makeProjStore(): ProjectionStorePort {
  return {
    async get() {
      return null;
    },
    async put() {},
    async list() {
      return [];
    },
    async checkpoint() {
      return null;
    },
    async setCheckpoint() {},
    async truncate() {},
  };
}

function makeFailingBus(): EventBusPort {
  return {
    async publish(_topic, _event) {
      throw new Error("bus is down");
    },
    subscribe() {
      return async () => {};
    },
  };
}

describe("H1: onPublishError observability", () => {
  it("fires onPublishError when direct publish fails (with outbox)", async () => {
    const errors: Array<{ event: FeedbackEvent; err: unknown }> = [];

    const enqueued: FeedbackEvent[] = [];
    const fakeOutbox = {
      async enqueue(event: FeedbackEvent) {
        enqueued.push(event);
      },
      async pickUnpublished() {
        return [];
      },
      async markPublished() {},
      async markFailed() {},
      async backlogSize() {
        return 0;
      },
      async oldestUnpublishedAgeMs() {
        return null;
      },
    };

    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjStore(),
      eventBus: makeFailingBus(),
      outbox: fakeOutbox,
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      onPublishError: (event, err) => {
        errors.push({ event, err });
      },
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

    // Wait one microtask for the fire-and-forget catch.
    await new Promise((r) => setTimeout(r, 50));

    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0]!.err as Error).message).toBe("bus is down");
    expect(enqueued.length).toBe(1); // outbox still enqueued
  });

  it("fires onPublishError AND throws when no outbox is configured", async () => {
    const errors: unknown[] = [];

    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjStore(),
      eventBus: makeFailingBus(),
      // No outbox
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      onPublishError: (_event, err) => {
        errors.push(err);
      },
    });

    await expect(
      feedback.capture({
        action: "approve",
        artifact_type: "draft",
        artifact_id: "a-1",
        artifact_version: 1,
        producer: "t",
        task_type: "t",
        payload: {},
      }),
    ).rejects.toThrow("bus is down");

    expect(errors.length).toBe(1);
  });

  it("does not require onPublishError (still backward compatible)", async () => {
    const enqueued: FeedbackEvent[] = [];
    const fakeOutbox = {
      async enqueue(event: FeedbackEvent) {
        enqueued.push(event);
      },
      async pickUnpublished() {
        return [];
      },
      async markPublished() {},
      async markFailed() {},
      async backlogSize() {
        return 0;
      },
      async oldestUnpublishedAgeMs() {
        return null;
      },
    };

    const feedback = createFeedback({
      eventStore: makeStore(),
      projectionStore: makeProjStore(),
      eventBus: makeFailingBus(),
      outbox: fakeOutbox,
      actions: DEFAULT_ACTIONS,
      artifactTypes: [{ name: "draft" }],
      // no onPublishError
    });

    // Should not throw even though bus fails
    await feedback.capture({
      action: "approve",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "t",
      task_type: "t",
      payload: {},
    });

    expect(enqueued.length).toBe(1);
  });
});

describe("H3: readStreamSince scopes history queries", () => {
  it("uses readStreamSince to bound history loading by timestamp", async () => {
    const calls: Array<{ method: string; pk: string; since?: string }> = [];

    const store: EventStorePort = {
      async withTransaction(work) {
        return work(undefined);
      },
      async append() {},
      async appendBatch() {},
      async *readStream(pk) {
        calls.push({ method: "readStream", pk });
      },
      async *readStreamSince(pk, since) {
        calls.push({ method: "readStreamSince", pk, since });
      },
      async *readAll() {},
      subscribeAll() {
        return async () => {};
      },
    };

    const rules = {
      async list() {
        return [
          {
            rule_id: "r1",
            applies_when: { action: "expired" },
            threshold: 5,
            window_ms: 24 * 60 * 60 * 1000,
            result_if_met: "blacklist" as const,
            active: true,
          },
        ];
      },
      async upsert() {},
      async remove() {},
    };

    const feedback = createFeedback({
      eventStore: store,
      projectionStore: makeProjStore(),
      inferenceRules: rules,
      historyWindowMs: 24 * 60 * 60 * 1000, // 1 day
      actions: [
        ...DEFAULT_ACTIONS,
        {
          name: "test",
          polarity: "positive",
          defaultInference: "observe",
          source: "explicit",
          payloadSchema: z.object({}),
        },
      ],
      artifactTypes: [{ name: "draft" }],
    });

    await feedback.capture({
      action: "test",
      artifact_type: "draft",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "t",
      task_type: "t",
      payload: {},
    });

    // History loader should call readStreamSince, NOT the unbounded readStream.
    expect(calls.find((c) => c.method === "readStreamSince")).toBeTruthy();
    expect(calls.find((c) => c.method === "readStream")).toBeFalsy();
    // The since timestamp should be roughly 1 day ago (within a generous tolerance).
    const sinceMs = Date.parse(calls[0]!.since!);
    const expected = Date.now() - 24 * 60 * 60 * 1000;
    expect(Math.abs(sinceMs - expected)).toBeLessThan(5_000);
  });
});
