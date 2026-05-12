import { describe, it, expect } from "vitest";
import { createInMemoryEventBus } from "../src/index.js";

describe("in-memory bus SubscribeOptions validation", () => {
  it("rejects on at-least-once subscription (unsupported)", async () => {
    const bus = createInMemoryEventBus();
    await expect(
      bus.subscribe("feedback.>", async () => {}, { deliveryMode: "at-least-once" }),
    ).rejects.toThrow(/does not support deliveryMode="at-least-once"/);
  });

  it("rejects on fromPosition='earliest' (unsupported, no retention)", async () => {
    const bus = createInMemoryEventBus();
    await expect(
      bus.subscribe("feedback.>", async () => {}, { fromPosition: "earliest" }),
    ).rejects.toThrow(/does not support fromPosition="earliest"/);
  });

  it("accepts at-most-once explicitly", async () => {
    const bus = createInMemoryEventBus();
    const unsub = await bus.subscribe("feedback.>", async () => {}, { deliveryMode: "at-most-once" });
    await unsub();
  });

  it("accepts fromPosition='latest' explicitly", async () => {
    const bus = createInMemoryEventBus();
    const unsub = await bus.subscribe("feedback.>", async () => {}, { fromPosition: "latest" });
    await unsub();
  });

  it("accepts no options at all", async () => {
    const bus = createInMemoryEventBus();
    const unsub = await bus.subscribe("feedback.>", async () => {});
    await unsub();
  });
});
