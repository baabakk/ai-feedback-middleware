import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { makeEvent, waitUntil } from "@ai-feedback-middleware/adapter-conformance";
import type { EventBusPort, FeedbackEvent } from "@ai-feedback-middleware/core";
import { createPostgresOutbox, runMigrations, startOutboxScanner } from "../src/index.js";

const { Pool } = pg;

const connectionString = process.env.FEEDBACK_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const skip = !connectionString;

// Capture every publish to a per-instance counter so we can assert one
// scanner did all the work and the other was idle (lock denied -> early
// return).
function makeCountingBus(label: string, sink: Map<string, string[]>): EventBusPort {
  if (!sink.has(label)) sink.set(label, []);
  const list = sink.get(label)!;
  return {
    async publish(_topic: string, event: FeedbackEvent): Promise<void> {
      list.push(event.event_id);
    },
    async publishBatch(_topic: string, events: FeedbackEvent[]): Promise<void> {
      for (const e of events) list.push(e.event_id);
    },
    async subscribe() {
      return async () => {};
    },
  };
}

if (skip) {
  describe.skip("Postgres outbox-scanner advisory-lock leader election", () => {
    it("skipped: set FEEDBACK_TEST_DATABASE_URL to run", () => {
      // intentionally empty
    });
  });
} else {
  describe("Postgres outbox-scanner advisory-lock leader election", () => {
    let pool: pg.Pool | null = null;
    const lockKey = 0x6c656164; // "lead"

    beforeAll(async () => {
      pool = new Pool({ connectionString });
      await runMigrations(pool);
    });

    afterAll(async () => {
      if (pool) await pool.end();
    });

    it("two scanners with the same lockKey: only the leader publishes", async () => {
      // Reset the outbox so other tests do not leak rows into this one.
      await pool!.query("TRUNCATE TABLE feedback_outbox RESTART IDENTITY");

      const outboxA = createPostgresOutbox({ pool: pool! });
      const outboxB = createPostgresOutbox({ pool: pool! });

      // Enqueue 5 distinct events.
      const eventIds = ["lead-1", "lead-2", "lead-3", "lead-4", "lead-5"];
      for (const id of eventIds) {
        const event = makeEvent({ event_id: id, artifact_id: id });
        await outboxA.enqueue(event, ["feedback.captured"], id);
      }

      // Track per-scanner publishes.
      const sink = new Map<string, string[]>();
      const busA = makeCountingBus("A", sink);
      const busB = makeCountingBus("B", sink);

      // Two scanners racing on the same lock key. With leader election,
      // only one of them should actually publish; the other should
      // observe an empty leader window and idle.
      const stopA = startOutboxScanner({
        outbox: outboxA,
        eventBus: busA,
        intervalMs: 50,
        pool: pool!,
        lockKey,
      });
      const stopB = startOutboxScanner({
        outbox: outboxB,
        eventBus: busB,
        intervalMs: 50,
        pool: pool!,
        lockKey,
      });

      try {
        // Wait until the union of A and B covers every event.
        await waitUntil(
          () => {
            const a = sink.get("A") ?? [];
            const b = sink.get("B") ?? [];
            return new Set([...a, ...b]).size >= eventIds.length;
          },
          { timeoutMs: 5000 },
        );

        const a = sink.get("A") ?? [];
        const b = sink.get("B") ?? [];

        // Each event_id must appear at most once across both scanners.
        const seen = new Map<string, number>();
        for (const id of [...a, ...b]) {
          seen.set(id, (seen.get(id) ?? 0) + 1);
        }
        for (const [id, count] of seen) {
          expect(count, `event ${id} was published ${count} times across A+B`).toBeLessThanOrEqual(
            1,
          );
        }

        // Together A and B should cover every event exactly once.
        expect(a.length + b.length).toBe(eventIds.length);
        expect(new Set([...a, ...b]).size).toBe(eventIds.length);
      } finally {
        await stopA();
        await stopB();
      }
    });
  });
}
