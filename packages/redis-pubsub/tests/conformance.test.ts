import { afterAll, describe, it } from "vitest";
import { runEventBusConformance } from "@llm-feedback-middleware/adapter-conformance";
import { createRedisPubSubEventBus } from "../src/index.js";

const connectionString = process.env.FEEDBACK_TEST_REDIS_URL ?? process.env.TEST_REDIS_URL;

const skip = !connectionString;

if (skip) {
  describe.skip("@llm-feedback-middleware/redis-pubsub conformance", () => {
    it("skipped: set FEEDBACK_TEST_REDIS_URL or TEST_REDIS_URL to run Redis tests", () => {
      // intentionally empty
    });
  });
} else {
  // Each conformance test uses a fresh bus + fresh topic prefix so subscribers
  // do not bleed across tests on a shared Redis.
  let testCount = 0;

  const buses: ReturnType<typeof createRedisPubSubEventBus>[] = [];

  runEventBusConformance({
    name: "RedisPubSubEventBus",
    factory: () => {
      testCount++;
      const bus = createRedisPubSubEventBus({
        connection: connectionString!,
        topicPrefix: `test-${process.pid}-${testCount}.`,
      });
      buses.push(bus);
      return bus;
    },
    cleanup: async (adapter) => {
      // The factory casts back to the typed object that has close(); call it.
      await (adapter as { close?: () => Promise<void> }).close?.();
    },
    deliveryTimeoutMs: 2000,
  });

  afterAll(async () => {
    for (const bus of buses) {
      await bus.close().catch(() => {});
    }
  });
}
