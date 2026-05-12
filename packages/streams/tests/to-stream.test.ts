import { describe, it, expect } from "vitest";
import { firstValueFrom, toArray, lastValueFrom } from "rxjs";
import { take, filter, bufferCount } from "../src/operators.js";
import { toStream, toEventStream } from "../src/index.js";
import { createInMemoryEventBus } from "@ai-feedback-middleware/in-memory";
import { makeReaction } from "@ai-feedback-middleware/adapter-conformance";

const makeEvent = makeReaction;

describe("toStream", () => {
  it("delivers events from the bus to a stream subscriber", async () => {
    const bus = createInMemoryEventBus();
    const stream = toStream(bus, "feedback.captured");

    const promise = firstValueFrom(stream);
    await bus.publish("feedback.captured", makeEvent({ event_id: "e1" }));

    const result = await promise;
    expect(result.event.event_id).toBe("e1");
    expect(result.topic).toBe("feedback.captured");
  });

  it("preserves the delivered topic in stream output", async () => {
    const bus = createInMemoryEventBus();
    const stream = toStream(bus, "feedback.captured.*");

    const got = lastValueFrom(stream.pipe(take(2), toArray()));
    await bus.publish("feedback.captured.explicit", makeEvent({ event_id: "exp" }));
    await bus.publish(
      "feedback.captured.implicit",
      makeEvent({ event_id: "imp", source: "implicit" }),
    );

    const result = await got;
    expect(result.map((r) => r.topic)).toEqual([
      "feedback.captured.explicit",
      "feedback.captured.implicit",
    ]);
  });

  it("supports operator composition: filter + take", async () => {
    const bus = createInMemoryEventBus();
    const stream = toEventStream(bus, "feedback.captured");

    const got = lastValueFrom(
      stream.pipe(
        filter((e) => e.event_kind === "reaction" && e.action === "approved"),
        take(2),
        toArray(),
      ),
    );

    await bus.publish(
      "feedback.captured",
      makeEvent({
        event_id: "edit",
        action: "manually_edited",
        evaluations: { content: "negative" },
      }),
    );
    await bus.publish("feedback.captured", makeEvent({ event_id: "a1" }));
    await bus.publish("feedback.captured", makeEvent({ event_id: "a2" }));

    const result = await got;
    expect(result.map((e) => e.event_id)).toEqual(["a1", "a2"]);
  });

  it("supports threshold crystallization via bufferCount", async () => {
    const bus = createInMemoryEventBus();
    const stream = toEventStream(bus, "feedback.captured");

    const got = lastValueFrom(
      stream.pipe(
        filter((e) => e.event_kind === "reaction" && e.action === "regenerated"),
        bufferCount(3),
        take(1),
      ),
    );

    for (let i = 0; i < 3; i++) {
      await bus.publish(
        "feedback.captured",
        makeEvent({
          event_id: `r${i}`,
          action: "regenerated",
          evaluations: { detection: "positive", content: "negative" },
        }),
      );
    }

    const batch = await got;
    expect(batch.map((e) => e.event_id)).toEqual(["r0", "r1", "r2"]);
  });
});
