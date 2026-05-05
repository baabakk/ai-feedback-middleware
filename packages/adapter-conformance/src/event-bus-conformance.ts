import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { EventBusPort } from "@llm-feedback-middleware/core";
import { makeEvent } from "./test-fixtures.js";

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
  /** How long to wait for async delivery in tests. Default 50ms. */
  deliveryWaitMs?: number;
}

export function runEventBusConformance(options: EventBusConformanceOptions): void {
  const supportsWildcards = options.supportsWildcards ?? true;
  const wait = options.deliveryWaitMs ?? 50;
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
      const unsub = bus.subscribe("feedback.captured", async (e) => {
        received.push(e.event_id);
      });
      try {
        await bus.publish("feedback.captured", makeEvent({ event_id: "e1" }));
        await new Promise((r) => setTimeout(r, wait));
        expect(received).toContain("e1");
      } finally {
        await unsub();
      }
    });

    it("subscriber does not receive events on different topics", async () => {
      const received: string[] = [];
      const unsub = bus.subscribe("feedback.captured.explicit.positive", async (e) => {
        received.push(e.event_id);
      });
      try {
        await bus.publish("feedback.captured.explicit.negative", makeEvent({ event_id: "neg" }));
        await new Promise((r) => setTimeout(r, wait));
        expect(received).not.toContain("neg");
      } finally {
        await unsub();
      }
    });

    it("multiple subscribers on the same topic each receive the event", async () => {
      const a: string[] = [];
      const b: string[] = [];
      const unsubA = bus.subscribe("feedback.captured", async (e) => {
        a.push(e.event_id);
      });
      const unsubB = bus.subscribe("feedback.captured", async (e) => {
        b.push(e.event_id);
      });
      try {
        await bus.publish("feedback.captured", makeEvent({ event_id: "shared" }));
        await new Promise((r) => setTimeout(r, wait));
        expect(a).toContain("shared");
        expect(b).toContain("shared");
      } finally {
        await unsubA();
        await unsubB();
      }
    });

    it("subscribe with array of topics receives events for all", async () => {
      const received: string[] = [];
      const unsub = bus.subscribe(
        ["feedback.captured.explicit.positive", "feedback.captured.implicit.positive"],
        async (e) => {
          received.push(e.event_id);
        },
      );
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
            polarity: "negative",
            inference: "blacklist",
            action: "reject",
          }),
        );
        await new Promise((r) => setTimeout(r, wait));
        expect(received).toContain("exp-pos");
        expect(received).toContain("imp-pos");
        expect(received).not.toContain("exp-neg");
      } finally {
        await unsub();
      }
    });

    it("unsubscribe stops further deliveries", async () => {
      const received: string[] = [];
      const unsub = bus.subscribe("feedback.captured", async (e) => {
        received.push(e.event_id);
      });
      await bus.publish("feedback.captured", makeEvent({ event_id: "before" }));
      await new Promise((r) => setTimeout(r, wait));
      await unsub();
      await bus.publish("feedback.captured", makeEvent({ event_id: "after" }));
      await new Promise((r) => setTimeout(r, wait));
      expect(received).toContain("before");
      expect(received).not.toContain("after");
    });

    it("preserves payload through the bus", async () => {
      let captured: unknown = null;
      const unsub = bus.subscribe("feedback.captured", async (e) => {
        captured = e.payload;
      });
      try {
        const payload = { foo: "bar", arr: [1, 2, 3], nested: { ok: true } };
        await bus.publish("feedback.captured", makeEvent({ event_id: "e1", payload }));
        await new Promise((r) => setTimeout(r, wait));
        expect(captured).toEqual(payload);
      } finally {
        await unsub();
      }
    });

    if (supportsWildcards) {
      it("wildcard subscribe matches sub-topics", async () => {
        const received: string[] = [];
        const unsub = bus.subscribe("feedback.captured.*", async (e) => {
          received.push(e.event_id);
        });
        try {
          await bus.publish("feedback.captured.explicit", makeEvent({ event_id: "exp" }));
          await bus.publish(
            "feedback.captured.implicit",
            makeEvent({ event_id: "imp", source: "implicit" }),
          );
          await new Promise((r) => setTimeout(r, wait));
          expect(received).toContain("exp");
          expect(received).toContain("imp");
        } finally {
          await unsub();
        }
      });
    }
  });
}
