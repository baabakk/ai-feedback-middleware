import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProjectionStorePort } from "@ai-feedback-middleware/core";

export interface ProjectionStoreConformanceOptions {
  name: string;
  factory: () => Promise<ProjectionStorePort> | ProjectionStorePort;
  cleanup?: (adapter: ProjectionStorePort) => Promise<void> | void;
  skip?: boolean;
}

/**
 * Run the ProjectionStorePort contract against an adapter implementation.
 */
export function runProjectionStoreConformance(options: ProjectionStoreConformanceOptions): void {
  const suite = options.skip ? describe.skip : describe;

  suite(`ProjectionStorePort conformance: ${options.name}`, () => {
    let store: ProjectionStorePort;

    beforeEach(async () => {
      store = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(store);
    });

    it("get returns null for missing keys", async () => {
      expect(await store.get("p", "k")).toBeNull();
    });

    it("put then get returns the stored state", async () => {
      await store.put("counter", "k1", { count: 5 }, "evt-1");
      expect(await store.get<{ count: number }>("counter", "k1")).toEqual({ count: 5 });
    });

    it("put overwrites prior state for the same key", async () => {
      await store.put("counter", "k1", { count: 1 }, "evt-1");
      await store.put("counter", "k1", { count: 99 }, "evt-2");
      expect(await store.get<{ count: number }>("counter", "k1")).toEqual({ count: 99 });
    });

    it("isolates keys per projection", async () => {
      await store.put("a", "k", { x: 1 }, "e1");
      await store.put("b", "k", { x: 2 }, "e2");
      expect(await store.get("a", "k")).toEqual({ x: 1 });
      expect(await store.get("b", "k")).toEqual({ x: 2 });
    });

    it("list returns all entries up to pageSize", async () => {
      await store.put("p", "a", { v: 1 }, "e1");
      await store.put("p", "b", { v: 2 }, "e2");
      await store.put("p", "c", { v: 3 }, "e3");
      const all = await store.list("p", undefined, 100);
      expect(all.length).toBe(3);
      const limited = await store.list("p", undefined, 2);
      expect(limited.length).toBe(2);
    });

    it("list returns empty for unknown projection", async () => {
      expect(await store.list("nonexistent", undefined, 100)).toEqual([]);
    });

    it("checkpoint round-trips", async () => {
      expect(await store.checkpoint("p")).toBeNull();
      await store.setCheckpoint("p", "evt-42");
      expect(await store.checkpoint("p")).toBe("evt-42");
      await store.setCheckpoint("p", "evt-99");
      expect(await store.checkpoint("p")).toBe("evt-99");
    });

    it("truncate clears state and checkpoint", async () => {
      await store.put("p", "k1", { x: 1 }, "e1");
      await store.put("p", "k2", { x: 2 }, "e2");
      await store.setCheckpoint("p", "e2");

      await store.truncate("p");

      expect(await store.get("p", "k1")).toBeNull();
      expect(await store.get("p", "k2")).toBeNull();
      expect(await store.checkpoint("p")).toBeNull();
    });

    it("truncate does not affect other projections", async () => {
      await store.put("a", "k", { x: 1 }, "e1");
      await store.put("b", "k", { x: 2 }, "e2");
      await store.truncate("a");
      expect(await store.get("a", "k")).toBeNull();
      expect(await store.get("b", "k")).toEqual({ x: 2 });
    });

    it("preserves complex nested state through round-trip", async () => {
      const complex = {
        items: [
          { id: "1", count: 5 },
          { id: "2", count: 10 },
        ],
        meta: { lastUpdated: "2026-04-24T00:00:00Z", version: 3 },
        tags: ["alpha", "beta", "gamma"],
      };
      await store.put("p", "k", complex, "e1");
      expect(await store.get("p", "k")).toEqual(complex);
    });
  });
}
