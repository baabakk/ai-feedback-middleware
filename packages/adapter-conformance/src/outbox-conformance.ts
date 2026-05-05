import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { OutboxPort } from "@llm-feedback-middleware/core";
import { makeEvent } from "./test-fixtures.js";

export interface OutboxConformanceOptions {
  name: string;
  factory: () => Promise<OutboxPort> | OutboxPort;
  cleanup?: (adapter: OutboxPort) => Promise<void> | void;
  skip?: boolean;
}

export function runOutboxConformance(options: OutboxConformanceOptions): void {
  const suite = options.skip ? describe.skip : describe;

  suite(`OutboxPort conformance: ${options.name}`, () => {
    let outbox: OutboxPort;

    beforeEach(async () => {
      outbox = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(outbox);
    });

    it("enqueue + pickUnpublished round-trip", async () => {
      const event = makeEvent({ event_id: "e1" });
      await outbox.enqueue(event, ["topic.a", "topic.b"]);

      const rows = await outbox.pickUnpublished(10);
      expect(rows.length).toBe(1);
      expect(rows[0]!.event_id).toBe("e1");
      expect(rows[0]!.topics).toEqual(["topic.a", "topic.b"]);
      expect(rows[0]!.event.event_id).toBe("e1");
    });

    it("pickUnpublished respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        await outbox.enqueue(makeEvent({ event_id: `e-${i}` }), ["topic"]);
      }
      const rows = await outbox.pickUnpublished(3);
      expect(rows.length).toBe(3);
    });

    it("markPublished removes row from pickUnpublished", async () => {
      await outbox.enqueue(makeEvent({ event_id: "e1" }), ["topic"]);
      await outbox.markPublished("e1");

      const rows = await outbox.pickUnpublished(10);
      expect(rows.find((r) => r.event_id === "e1")).toBeUndefined();
    });

    it("markFailed increments attempt_count and stores last_error", async () => {
      await outbox.enqueue(makeEvent({ event_id: "e1" }), ["topic"]);
      await outbox.markFailed("e1", "boom", 0); // 0ms backoff so picks up immediately

      const rows = await outbox.pickUnpublished(10);
      const row = rows.find((r) => r.event_id === "e1");
      expect(row).toBeTruthy();
      expect(row!.attempt_count).toBe(1);
      expect(row!.last_error).toBe("boom");
    });

    it("markFailed with backoff hides row until next_attempt_at", async () => {
      await outbox.enqueue(makeEvent({ event_id: "e1" }), ["topic"]);
      await outbox.markFailed("e1", "transient", 5000); // 5s backoff

      const rows = await outbox.pickUnpublished(10);
      expect(rows.find((r) => r.event_id === "e1")).toBeUndefined();
    });

    it("backlogSize counts only unpublished rows", async () => {
      await outbox.enqueue(makeEvent({ event_id: "e1" }), ["t"]);
      await outbox.enqueue(makeEvent({ event_id: "e2" }), ["t"]);
      await outbox.enqueue(makeEvent({ event_id: "e3" }), ["t"]);
      expect(await outbox.backlogSize()).toBe(3);

      await outbox.markPublished("e2");
      expect(await outbox.backlogSize()).toBe(2);
    });

    it("oldestUnpublishedAgeMs returns null when empty", async () => {
      expect(await outbox.oldestUnpublishedAgeMs()).toBeNull();
    });

    it("oldestUnpublishedAgeMs returns a non-negative number when present", async () => {
      await outbox.enqueue(makeEvent({ event_id: "e1" }), ["t"]);
      const age = await outbox.oldestUnpublishedAgeMs();
      expect(age).not.toBeNull();
      expect(age!).toBeGreaterThanOrEqual(0);
    });

    it("preserves the full event payload through enqueue + pickUnpublished", async () => {
      const event = makeEvent({
        event_id: "with-payload",
        action: "edit",
        polarity: "negative",
        inference: "blacklist",
        payload: {
          original: "Dear Sir/Madam",
          corrected: "Hi",
          diff_labels: ["remove_formality"],
        },
      });
      await outbox.enqueue(event, ["t"]);
      const rows = await outbox.pickUnpublished(10);
      expect(rows[0]!.event.payload).toEqual(event.payload);
      expect(rows[0]!.event.action).toBe("edit");
      expect(rows[0]!.event.inference).toBe("blacklist");
    });
  });
}
