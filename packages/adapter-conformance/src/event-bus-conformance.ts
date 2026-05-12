import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { EventBusPort } from "@ai-feedback-middleware/core";
import { makeReaction } from "./test-fixtures.js";
import { waitUntil } from "./poll.js";

const makeEvent = makeReaction;

export interface EventBusConformanceOptions {
  name: string;
  factory: () => Promise<EventBusPort> | EventBusPort;
  cleanup?: (adapter: EventBusPort) => Promise<void> | void;
  skip?: boolean;
  /**
   * Adapter supports topic wildcards (e.g., `feedback.captured.*`).
   * Default true. Adapters without wildcard support skip those tests.
   */
  supportsWildcards?: boolean;
  /**
   * Maximum time the suite will wait for an event to be delivered before
   * declaring failure. Default 1500ms. Replaces the earlier fixed-wait
   * `setTimeout(50)` approach which produced flaky CI failures on slow
   * runners. Tests poll the predicate every 10ms and exit as soon as it
   * passes, so the budget is a ceiling rather than a hard wait.
   */
  deliveryTimeoutMs?: number;
}

export function runEventBusConformance(options: EventBusConformanceOptions): void {
  const supportsWildcards = options.supportsWildcards ?? true;
  const timeoutMs = options.deliveryTimeoutMs ?? 1500;
  const suite = options.skip ? describe.skip : describe;

  suite(`EventBusPort conformance: ${options.name}`, () => {
    let bus: EventBusPort;

    beforeEach(async () => {
      bus = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(bus);
    });

    it("publish + subscribe round-trip on exact topic", async () => {
      const received: string[] = [];
      const unsub = await bus.subscribe("feedback.captured", async (e) => {
        received.push(e.event_id);
      });
      try {
        await bus.publish("feedback.captured", makeEvent({ event_id: "e1" }));
        await waitUntil(() => received.includes("e1"), { timeoutMs });
        expect(received).toContain("e1");
      } finally {
        await unsub();
      }
    });

    it("subscriber does not receive events on different topics", async () => {
      const received: string[] = [];
      const otherReceived: string[] = [];
      const unsub = await bus.subscribe("feedback.captured.explicit.positive", async (e) => {
        received.push(e.event_id);
      });
      // Probe subscriber on the actual published topic so we can wait until
      // delivery has happened; without this we'd be waiting blind.
      const unsubProbe = await bus.subscribe("feedback.captured.explicit.negative", async (e) => {
        otherReceived.push(e.event_id);
      });
      try {
        await bus.publish("feedback.captured.explicit.negative", makeEvent({ event_id: "neg" }));
        await waitUntil(() => otherReceived.includes("neg"), { timeoutMs });
        expect(received).not.toContain("neg");
      } finally {
        await unsub();
        await unsubProbe();
      }
    });

    it("multiple subscribers on the same topic each receive the event", async () => {
      const a: string[] = [];
      const b: string[] = [];
      const unsubA = await bus.subscribe("feedback.captured", async (e) => {
        a.push(e.event_id);
      });
      const unsubB = await bus.subscribe("feedback.captured", async (e) => {
        b.push(e.event_id);
      });
      try {
        await bus.publish("feedback.captured", makeEvent({ event_id: "shared" }));
        await waitUntil(() => a.includes("shared") && b.includes("shared"), { timeoutMs });
        expect(a).toContain("shared");
        expect(b).toContain("shared");
      } finally {
        await unsubA();
        await unsubB();
      }
    });

    it("subscribe with array of topics receives events for all", async () => {
      const received: string[] = [];
      const unsub = await bus.subscribe(
        ["feedback.captured.explicit.positive", "feedback.captured.implicit.positive"],
        async (e) => {
          received.push(e.event_id);
        },
      );
      // Probe to know when the negative publish has been processed by the bus.
      const negSeen: string[] = [];
      const unsubProbe = await bus.subscribe("feedback.captured.explicit.negative", async (e) => {
        negSeen.push(e.event_id);
      });
      try {
        await bus.publish(
          "feedback.captured.explicit.positive",
          makeEvent({ event_id: "exp-pos" }),
        );
        await bus.publish(
          "feedback.captured.implicit.positive",
          makeEvent({ event_id: "imp-pos", source: "implicit" }),
        );
        await bus.publish(
          "feedback.captured.explicit.negative",
          makeEvent({
            event_id: "exp-neg",
            action: "rejected",
            evaluations: { content: "negative" },
          }),
        );
        await waitUntil(
          () =>
            received.includes("exp-pos") &&
            received.includes("imp-pos") &&
            negSeen.includes("exp-neg"),
          { timeoutMs },
        );
        expect(received).toContain("exp-pos");
        expect(received).toContain("imp-pos");
        expect(received).not.toContain("exp-neg");
      } finally {
        await unsub();
        await unsubProbe();
      }
    });

    it("unsubscribe stops further deliveries", async () => {
      const received: string[] = [];
      const unsub = await bus.subscribe("feedback.captured", async (e) => {
        received.push(e.event_id);
      });
      await bus.publish("feedback.captured", makeEvent({ event_id: "before" }));
      await waitUntil(() => received.includes("before"), { timeoutMs });
      await unsub();
      // After unsubscribing, install a probe so we can detect when the
      // next publish has reached the bus, then assert the original
      // subscriber never saw it.
      const probe: string[] = [];
      const unsubProbe = await bus.subscribe("feedback.captured", async (e) => {
        probe.push(e.event_id);
      });
      try {
        await bus.publish("feedback.captured", makeEvent({ event_id: "after" }));
        await waitUntil(() => probe.includes("after"), { timeoutMs });
        expect(received).toContain("before");
        expect(received).not.toContain("after");
      } finally {
        await unsubProbe();
      }
    });

    it("preserves payload through the bus", async () => {
      let captured: unknown = null;
      const unsub = await bus.subscribe("feedback.captured", async (e) => {
        captured = e.payload;
      });
      try {
        const payload = { foo: "bar", arr: [1, 2, 3], nested: { ok: true } };
        await bus.publish("feedback.captured", makeEvent({ event_id: "e1", payload }));
        await waitUntil(() => captured !== null, { timeoutMs });
        expect(captured).toEqual(payload);
      } finally {
        await unsub();
      }
    });

    it("a throwing subscriber does not block other subscribers on the same topic", async () => {
      // Fault-injection scenario: one handler throws every time. Other
      // handlers on the same topic must still receive events; the throwing
      // handler's events must surface through the adapter's onError
      // callback (or be absorbed but not block other dispatches).
      const goodA: string[] = [];
      const goodB: string[] = [];
      const unsubBad = await bus.subscribe("feedback.captured", async () => {
        throw new Error("intentional handler failure for fault-injection conformance");
      });
      const unsubA = await bus.subscribe("feedback.captured", async (e) => {
        goodA.push(e.event_id);
      });
      const unsubB = await bus.subscribe("feedback.captured", async (e) => {
        goodB.push(e.event_id);
      });
      try {
        await bus.publish("feedback.captured", makeEvent({ event_id: "fault-1" }));
        await waitUntil(() => goodA.includes("fault-1") && goodB.includes("fault-1"), {
          timeoutMs,
        });
        expect(goodA).toContain("fault-1");
        expect(goodB).toContain("fault-1");
      } finally {
        await unsubBad();
        await unsubA();
        await unsubB();
      }
    });

    if (supportsWildcards) {
      it("wildcard subscribe matches sub-topics", async () => {
        const received: string[] = [];
        const unsub = await bus.subscribe("feedback.captured.*", async (e) => {
          received.push(e.event_id);
        });
        try {
          await bus.publish("feedback.captured.explicit", makeEvent({ event_id: "exp" }));
          await bus.publish(
            "feedback.captured.implicit",
            makeEvent({ event_id: "imp", source: "implicit" }),
          );
          await waitUntil(() => received.includes("exp") && received.includes("imp"), {
            timeoutMs,
          });
          expect(received).toContain("exp");
          expect(received).toContain("imp");
        } finally {
          await unsub();
        }
      });
    }
  });
}
