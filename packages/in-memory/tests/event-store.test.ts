import { describe, it, expect } from "vitest";
import type { FeedbackEvent } from "@llm-feedback-middleware/core";
import { createInMemoryEventStore } from "../src/event-store.js";

function makeEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    event_id: "e1",
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

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("InMemoryEventStore", () => {
  it("appends and reads back from partition stream", async () => {
    const store = createInMemoryEventStore();
    await store.append(makeEvent({ event_id: "e1" }));
    await store.append(makeEvent({ event_id: "e2" }));

    const events = await collect(store.readStream("p-1"));
    expect(events.map((e) => e.event_id)).toEqual(["e1", "e2"]);
  });

  it("isolates by partition_key", async () => {
    const store = createInMemoryEventStore();
    await store.append(makeEvent({ event_id: "a", partition_key: "p-A", artifact_id: "p-A" }));
    await store.append(makeEvent({ event_id: "b", partition_key: "p-B", artifact_id: "p-B" }));
    await store.append(makeEvent({ event_id: "c", partition_key: "p-A", artifact_id: "p-A" }));

    expect((await collect(store.readStream("p-A"))).map((e) => e.event_id)).toEqual(["a", "c"]);
    expect((await collect(store.readStream("p-B"))).map((e) => e.event_id)).toEqual(["b"]);
  });

  it("appendBatch stores all events in order", async () => {
    const store = createInMemoryEventStore();
    await store.appendBatch([
      makeEvent({ event_id: "x" }),
      makeEvent({ event_id: "y" }),
      makeEvent({ event_id: "z" }),
    ]);
    expect((await collect(store.readStream("p-1"))).map((e) => e.event_id)).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("readAll returns all events without filter", async () => {
    const store = createInMemoryEventStore();
    await store.append(makeEvent({ event_id: "a", partition_key: "p1", artifact_id: "p1" }));
    await store.append(makeEvent({ event_id: "b", partition_key: "p2", artifact_id: "p2" }));
    expect((await collect(store.readAll())).map((e) => e.event_id)).toEqual(["a", "b"]);
  });

  it("readAll respects polarity filter", async () => {
    const store = createInMemoryEventStore();
    await store.append(makeEvent({ event_id: "p", polarity: "positive" }));
    await store.append(
      makeEvent({ event_id: "n", polarity: "negative", inference: "blacklist", action: "reject" }),
    );
    const negs = await collect(store.readAll({ polarity: "negative" }));
    expect(negs.map((e) => e.event_id)).toEqual(["n"]);
  });

  it("readAll respects action filter", async () => {
    const store = createInMemoryEventStore();
    await store.append(makeEvent({ event_id: "a1", action: "approve" }));
    await store.append(
      makeEvent({
        event_id: "e1",
        action: "edit",
        polarity: "negative",
        inference: "blacklist",
      }),
    );
    expect((await collect(store.readAll({ action: "approve" }))).map((e) => e.event_id)).toEqual([
      "a1",
    ]);
  });

  it("subscribeAll receives appended events", async () => {
    const store = createInMemoryEventStore();
    const received: string[] = [];
    const unsub = store.subscribeAll(async (e) => {
      received.push(e.event_id);
    });
    await store.append(makeEvent({ event_id: "s1" }));
    await store.append(makeEvent({ event_id: "s2" }));
    expect(received).toEqual(["s1", "s2"]);
    await unsub();
    await store.append(makeEvent({ event_id: "s3" }));
    expect(received).toEqual(["s1", "s2"]); // s3 not delivered after unsubscribe
  });

  it("seed initializes the store with events", async () => {
    const store = createInMemoryEventStore({
      seed: [makeEvent({ event_id: "seed1" }), makeEvent({ event_id: "seed2" })],
    });
    const events = await collect(store.readStream("p-1"));
    expect(events.map((e) => e.event_id)).toEqual(["seed1", "seed2"]);
  });
});
