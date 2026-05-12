import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { CapturedEvaluatedReactionEvent, EventStorePort } from "@ai-feedback-middleware/core";
import { collect, makeReaction } from "./test-fixtures.js";
import { waitUntil } from "./poll.js";

export interface EventStoreConformanceOptions {
  /** Display name shown in the test report. */
  name: string;
  /** Build a fresh adapter for each test (or returns an existing isolated instance). */
  factory: () => Promise<EventStorePort> | EventStorePort;
  /** Optional cleanup after each test (drop tables, close connections, etc.). */
  cleanup?: (adapter: EventStorePort) => Promise<void> | void;
  /** Skip the entire suite (e.g. when DATABASE_URL not set). */
  skip?: boolean;
  /** Adapter advertises subscribeAll? Defaults to true. Set false for pure store-without-bus adapters. */
  supportsSubscribe?: boolean;
}

/**
 * Run the EventStorePort contract against an adapter implementation.
 *
 * Registers a vitest `describe` block. Call from your adapter's test file.
 *
 * v2.1: events are reactions (the most common shape). Adapters that store
 * both `captured_artifacts` and `captured_evaluated_reactions` route the
 * append based on `event_kind`; the conformance suite exercises reactions
 * since they cover the action / source / per-axis-evaluation surface that
 * exercises filter coverage.
 */
export function runEventStoreConformance(options: EventStoreConformanceOptions): void {
  const supportsSubscribe = options.supportsSubscribe ?? true;
  const suite = options.skip ? describe.skip : describe;

  suite(`EventStorePort conformance: ${options.name}`, () => {
    let adapter: EventStorePort;

    beforeEach(async () => {
      adapter = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(adapter);
    });

    it("appends and reads back from partition stream in append order", async () => {
      await adapter.append(makeReaction({ event_id: "e1" }));
      await adapter.append(makeReaction({ event_id: "e2" }));
      await adapter.append(makeReaction({ event_id: "e3" }));

      const events = await collect(adapter.readStream("p-1"));
      expect(events.map((e) => e.event_id)).toEqual(["e1", "e2", "e3"]);
    });

    it("isolates events by partition_key", async () => {
      await adapter.append(
        makeReaction({ event_id: "a", partition_key: "p-A", artifact_id: "p-A" }),
      );
      await adapter.append(
        makeReaction({ event_id: "b", partition_key: "p-B", artifact_id: "p-B" }),
      );
      await adapter.append(
        makeReaction({ event_id: "c", partition_key: "p-A", artifact_id: "p-A" }),
      );

      const a = await collect(adapter.readStream("p-A"));
      const b = await collect(adapter.readStream("p-B"));
      expect(a.map((e) => e.event_id)).toEqual(["a", "c"]);
      expect(b.map((e) => e.event_id)).toEqual(["b"]);
    });

    it("readStream respects fromVersion lower bound", async () => {
      await adapter.append(makeReaction({ event_id: "v1", artifact_version: 1 }));
      await adapter.append(makeReaction({ event_id: "v2", artifact_version: 2 }));
      await adapter.append(makeReaction({ event_id: "v3", artifact_version: 3 }));

      const v2plus = await collect(adapter.readStream("p-1", 2));
      expect(v2plus.map((e) => e.event_id)).toEqual(["v2", "v3"]);
    });

    it("readStreamSince filters events older than the cutoff", async () => {
      await adapter.append(makeReaction({ event_id: "old", occurred_at: "2026-01-01T00:00:00Z" }));
      await adapter.append(makeReaction({ event_id: "mid", occurred_at: "2026-04-01T00:00:00Z" }));
      await adapter.append(makeReaction({ event_id: "new", occurred_at: "2026-04-20T00:00:00Z" }));

      const since = "2026-03-15T00:00:00Z";
      const recent = await collect(adapter.readStreamSince("p-1", since));
      const ids = recent.map((e) => e.event_id);
      expect(ids).toContain("mid");
      expect(ids).toContain("new");
      expect(ids).not.toContain("old");
    });

    it("readStreamSince scopes by partition_key", async () => {
      await adapter.append(
        makeReaction({
          event_id: "a-recent",
          partition_key: "p-A",
          artifact_id: "p-A",
          occurred_at: "2026-04-20T00:00:00Z",
        }),
      );
      await adapter.append(
        makeReaction({
          event_id: "b-recent",
          partition_key: "p-B",
          artifact_id: "p-B",
          occurred_at: "2026-04-20T00:00:00Z",
        }),
      );

      const aOnly = await collect(adapter.readStreamSince("p-A", "2026-04-01T00:00:00Z"));
      expect(aOnly.map((e) => e.event_id)).toEqual(["a-recent"]);
    });

    it("appendBatch preserves order", async () => {
      await adapter.appendBatch([
        makeReaction({ event_id: "x" }),
        makeReaction({ event_id: "y" }),
        makeReaction({ event_id: "z" }),
      ]);
      const events = await collect(adapter.readStream("p-1"));
      expect(events.map((e) => e.event_id)).toEqual(["x", "y", "z"]);
    });

    it("readAll returns events across all partitions in append order", async () => {
      await adapter.append(makeReaction({ event_id: "1", partition_key: "p1", artifact_id: "p1" }));
      await adapter.append(makeReaction({ event_id: "2", partition_key: "p2", artifact_id: "p2" }));
      await adapter.append(makeReaction({ event_id: "3", partition_key: "p1", artifact_id: "p1" }));

      const all = await collect(adapter.readAll());
      expect(all.map((e) => e.event_id)).toEqual(["1", "2", "3"]);
    });

    it("readAll respects action filter", async () => {
      await adapter.append(makeReaction({ event_id: "a1", action: "approved" }));
      await adapter.append(
        makeReaction({
          event_id: "e1",
          action: "manually_edited",
          evaluations: { content: "negative" },
        }),
      );
      const approved = await collect(adapter.readAll({ action: "approved" }));
      expect(approved.map((e) => e.event_id)).toEqual(["a1"]);
    });

    it("readAll respects producer filter", async () => {
      await adapter.append(makeReaction({ event_id: "a", producer: "agent-a" }));
      await adapter.append(makeReaction({ event_id: "b", producer: "agent-b" }));
      await adapter.append(makeReaction({ event_id: "c", producer: "agent-a" }));
      const fromA = await collect(adapter.readAll({ producer: "agent-a" }));
      expect(fromA.map((e) => e.event_id).sort()).toEqual(["a", "c"]);
    });

    it("readAll respects source filter", async () => {
      await adapter.append(makeReaction({ event_id: "expl", source: "explicit" }));
      await adapter.append(
        makeReaction({
          event_id: "impl",
          source: "implicit",
          action: "silently_accepted",
          evaluations: { detection: "positive", content: "positive" },
        }),
      );
      const explicits = await collect(adapter.readAll({ source: "explicit" }));
      expect(explicits.map((e) => e.event_id)).toEqual(["expl"]);
    });

    it("preserves payload contents through round-trip", async () => {
      const payload = {
        original: "Dear Sir/Madam",
        corrected: "Hi",
        diff_labels: ["remove_formality", "reduce_length"],
        nested: { foo: "bar", count: 42 },
      };
      await adapter.append(
        makeReaction({
          event_id: "with-payload",
          action: "manually_edited",
          evaluations: { content: "negative" },
          payload,
        }),
      );
      const [event] = await collect(adapter.readStream("p-1"));
      expect(event!.payload).toEqual(payload);
    });

    it("preserves provenance through round-trip", async () => {
      await adapter.append(
        makeReaction({
          event_id: "with-prov",
          provenance: {
            channel: "telegram",
            instance_id: "tg-123",
            latency_ms: 450,
            captured_by_adapter: "explicit_button",
          },
        }),
      );
      const [event] = await collect(adapter.readStream("p-1"));
      expect(event!.provenance.channel).toBe("telegram");
      expect(event!.provenance.instance_id).toBe("tg-123");
      expect(event!.provenance.latency_ms).toBe(450);
      expect(event!.provenance.captured_by_adapter).toBe("explicit_button");
    });

    it("preserves correction_of_event_id linkage on a 'corrected' tombstone", async () => {
      await adapter.append(makeReaction({ event_id: "original" }));
      await adapter.append(
        makeReaction({
          event_id: "correction",
          action: "corrected",
          source: "meta",
          evaluations: {},
          correction_of_event_id: "original",
          payload: { reason: "race_condition" },
        }),
      );
      const events = await collect(adapter.readStream("p-1"));
      const correction = events.find(
        (e): e is CapturedEvaluatedReactionEvent => e.event_id === "correction",
      );
      expect(correction?.correction_of_event_id).toBe("original");
    });

    it("preserves per-axis evaluations through round-trip", async () => {
      await adapter.append(
        makeReaction({
          event_id: "with-eval",
          action: "manually_edited",
          evaluations: {
            detection: "positive",
            content: "negative",
            timing: "positive",
            channel: "positive",
          },
        }),
      );
      const [event] = await collect(adapter.readStream("p-1"));
      const reaction = event as CapturedEvaluatedReactionEvent;
      expect(reaction.evaluations).toEqual({
        detection: "positive",
        content: "negative",
        timing: "positive",
        channel: "positive",
      });
    });

    it("readRecentReactions filters by partition + window", async () => {
      await adapter.append(makeReaction({ event_id: "old", occurred_at: "2026-01-01T00:00:00Z" }));
      await adapter.append(makeReaction({ event_id: "new", occurred_at: "2026-04-20T00:00:00Z" }));
      const recent = await adapter.readRecentReactions({
        partition_key: "p-1",
        since_timestamp: "2026-03-01T00:00:00Z",
      });
      expect(recent.map((e) => e.event_id)).toEqual(["new"]);
    });

    it("readTombstonedArtifactIds reports artifact_ids with tombstone reactions", async () => {
      await adapter.append(makeReaction({ event_id: "live", artifact_id: "a-live" }));
      await adapter.append(
        makeReaction({
          event_id: "dead",
          artifact_id: "a-dead",
          action: "cancelled",
          source: "meta",
          evaluations: {},
          payload: { reason: "duplicate" },
        }),
      );
      const tombstoned = await adapter.readTombstonedArtifactIds({
        candidate_artifact_ids: ["a-live", "a-dead"],
      });
      expect(tombstoned.has("a-dead")).toBe(true);
      expect(tombstoned.has("a-live")).toBe(false);
    });

    if (supportsSubscribe) {
      it("subscribeAll receives appended events", async () => {
        const received: string[] = [];
        const unsub = adapter.subscribeAll(async (e) => {
          received.push(e.event_id);
        });
        try {
          await adapter.append(makeReaction({ event_id: "s1" }));
          await adapter.append(makeReaction({ event_id: "s2" }));
          await waitUntil(() => received.includes("s1") && received.includes("s2"), {
            timeoutMs: 2000,
          });
          expect(received).toContain("s1");
          expect(received).toContain("s2");
        } finally {
          await unsub();
        }
      });

      it("subscribeAll stops receiving after unsubscribe", async () => {
        const received: string[] = [];
        const unsub = adapter.subscribeAll(async (e) => {
          received.push(e.event_id);
        });
        await adapter.append(makeReaction({ event_id: "before" }));
        await waitUntil(() => received.includes("before"), { timeoutMs: 2000 });
        await unsub();
        await adapter.append(makeReaction({ event_id: "after" }));
        // Give the adapter a chance to (incorrectly) deliver. If it does, the
        // test fails; if not, we move on. 2× the longest expected poll cycle.
        await new Promise((r) => setTimeout(r, 200));
        expect(received).toContain("before");
        expect(received).not.toContain("after");
      });
    }

    it("rebuild scenario: 100 events written, readAll returns all, in order", async () => {
      const events = Array.from({ length: 100 }, (_, i) =>
        makeReaction({
          event_id: `bulk-${i.toString().padStart(3, "0")}`,
          partition_key: `p-${i % 5}`,
          artifact_id: `p-${i % 5}`,
        }),
      );
      await adapter.appendBatch(events);
      const all = await collect(adapter.readAll());
      expect(all.length).toBe(100);
      expect(all.map((e) => e.event_id)).toEqual(events.map((e) => e.event_id));
    });
  });
}
