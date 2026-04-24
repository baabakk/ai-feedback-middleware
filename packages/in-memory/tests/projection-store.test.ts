import { describe, it, expect } from "vitest";
import { createInMemoryProjectionStore } from "../src/projection-store.js";

describe("InMemoryProjectionStore", () => {
  it("get returns null for missing keys", async () => {
    const store = createInMemoryProjectionStore();
    expect(await store.get("p", "k")).toBeNull();
  });

  it("put then get returns the stored state", async () => {
    const store = createInMemoryProjectionStore();
    await store.put("counter", "k1", { count: 5 }, "evt-1");
    expect(await store.get<{ count: number }>("counter", "k1")).toEqual({ count: 5 });
  });

  it("isolates keys per projection", async () => {
    const store = createInMemoryProjectionStore();
    await store.put("a", "k", { x: 1 }, "e1");
    await store.put("b", "k", { x: 2 }, "e2");
    expect(await store.get("a", "k")).toEqual({ x: 1 });
    expect(await store.get("b", "k")).toEqual({ x: 2 });
  });

  it("list returns all entries up to pageSize", async () => {
    const store = createInMemoryProjectionStore();
    await store.put("p", "a", { v: 1 }, "e1");
    await store.put("p", "b", { v: 2 }, "e2");
    await store.put("p", "c", { v: 3 }, "e3");
    const all = await store.list("p", undefined, 100);
    expect(all.length).toBe(3);
    const limited = await store.list("p", undefined, 2);
    expect(limited.length).toBe(2);
  });

  it("checkpoint round-trips", async () => {
    const store = createInMemoryProjectionStore();
    expect(await store.checkpoint("p")).toBeNull();
    await store.setCheckpoint("p", "evt-42");
    expect(await store.checkpoint("p")).toBe("evt-42");
  });

  it("truncate clears state and checkpoint", async () => {
    const store = createInMemoryProjectionStore();
    await store.put("p", "k", { x: 1 }, "e1");
    await store.setCheckpoint("p", "e1");
    await store.truncate("p");
    expect(await store.get("p", "k")).toBeNull();
    expect(await store.checkpoint("p")).toBeNull();
  });
});
