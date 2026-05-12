import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DedupeStorePort } from "@ai-feedback-middleware/core";

export interface DedupeStoreConformanceOptions {
  name: string;
  factory: () => Promise<DedupeStorePort> | DedupeStorePort;
  cleanup?: (adapter: DedupeStorePort) => Promise<void> | void;
  skip?: boolean;
}

export function runDedupeStoreConformance(options: DedupeStoreConformanceOptions): void {
  const suite = options.skip ? describe.skip : describe;

  suite(`DedupeStorePort conformance: ${options.name}`, () => {
    let store: DedupeStorePort;

    beforeEach(async () => {
      store = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(store);
    });

    it("seen returns false for unmarked keys", async () => {
      expect(await store.seen("nope")).toBe(false);
    });

    it("mark then seen returns true", async () => {
      await store.mark("k1", 60_000);
      expect(await store.seen("k1")).toBe(true);
    });

    it("isolates keys", async () => {
      await store.mark("a", 60_000);
      expect(await store.seen("a")).toBe(true);
      expect(await store.seen("b")).toBe(false);
    });

    it("mark with very short TTL expires", async () => {
      await store.mark("ephemeral", 1);
      await new Promise((r) => setTimeout(r, 20));
      expect(await store.seen("ephemeral")).toBe(false);
    });
  });
}
