import { describe, it, expect } from "vitest";
import { createInMemoryEventBus } from "../src/index.js";

describe("in-memory bus SubscribeOptions validation", () => {
  it("throws on at-least-once subscription (unsupported)", () => {
    const bus = createInMemoryEventBus();
    expect(() =>
      bus.subscribe("feedback.>", async () => {}, { deliveryMode: "at-least-once" }),
    ).toThrow(/does not support deliveryMode="at-least-once"/);
  });

  it("throws on fromPosition='earliest' (unsupported, no retention)", () => {
    const bus = createInMemoryEventBus();
    expect(() => bus.subscribe("feedback.>", async () => {}, { fromPosition: "earliest" })).toThrow(
      /does not support fromPosition="earliest"/,
    );
  });

  it("accepts at-most-once explicitly", async () => {
    const bus = createInMemoryEventBus();
    const unsub = bus.subscribe("feedback.>", async () => {}, { deliveryMode: "at-most-once" });
    await unsub();
  });

  it("accepts fromPosition='latest' explicitly", async () => {
    const bus = createInMemoryEventBus();
    const unsub = bus.subscribe("feedback.>", async () => {}, { fromPosition: "latest" });
    await unsub();
  });

  it("accepts no options at all", async () => {
    const bus = createInMemoryEventBus();
    const unsub = bus.subscribe("feedback.>", async () => {});
    await unsub();
  });
});
