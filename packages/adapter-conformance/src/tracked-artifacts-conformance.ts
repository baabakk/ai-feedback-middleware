import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TrackedArtifactRow, TrackedArtifactsPort } from "@ai-feedback-middleware/core";

export interface TrackedArtifactsConformanceOptions {
  name: string;
  factory: () => Promise<TrackedArtifactsPort> | TrackedArtifactsPort;
  cleanup?: (adapter: TrackedArtifactsPort) => Promise<void> | void;
  skip?: boolean;
}

function row(overrides: Partial<TrackedArtifactRow> = {}): TrackedArtifactRow {
  return {
    artifact_id: "a-1",
    artifact_type: "draft_email",
    artifact_version: 1,
    partition_key: "a-1",
    producer: "test-producer",
    task_type: "test:task",
    status: "waiting",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function runTrackedArtifactsConformance(options: TrackedArtifactsConformanceOptions): void {
  const suite = options.skip ? describe.skip : describe;

  suite(`TrackedArtifactsPort conformance: ${options.name}`, () => {
    let store: TrackedArtifactsPort;

    beforeEach(async () => {
      store = await options.factory();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(store);
    });

    it("insertWaiting + getByArtifactId round-trip", async () => {
      await store.insertWaiting(row({ artifact_id: "a-1" }));
      const found = await store.getByArtifactId("a-1");
      expect(found?.artifact_id).toBe("a-1");
      expect(found?.status).toBe("waiting");
    });

    it("getByArtifactId returns null for missing artifact", async () => {
      expect(await store.getByArtifactId("never-existed")).toBeNull();
    });

    it("markTerminal transitions status and stores reaction event id", async () => {
      await store.insertWaiting(row({ artifact_id: "a-1" }));
      const at = new Date().toISOString();
      await store.markTerminal("a-1", "reacted", "evt-r1", at);
      const found = await store.getByArtifactId("a-1");
      expect(found?.status).toBe("reacted");
      expect(found?.terminal_reaction_event_id).toBe("evt-r1");
      expect(found?.terminal_status_at).toBe(at);
    });

    it("markTerminal is idempotent: second call on already-terminal row is a no-op", async () => {
      await store.insertWaiting(row({ artifact_id: "a-1" }));
      const first = new Date().toISOString();
      await store.markTerminal("a-1", "reacted", "evt-r1", first);
      const later = new Date(Date.now() + 1000).toISOString();
      await store.markTerminal("a-1", "cancelled", "evt-c1", later);
      const found = await store.getByArtifactId("a-1");
      expect(found?.status).toBe("reacted");
      expect(found?.terminal_reaction_event_id).toBe("evt-r1");
    });

    it("claimDueWaiting returns rows whose deadline has passed", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60_000).toISOString();
      await store.insertWaiting(row({ artifact_id: "a-due", expires_at: past }));
      await store.insertWaiting(row({ artifact_id: "a-not-due", expires_at: future }));

      const claimed = await store.claimDueWaiting({
        now: new Date().toISOString(),
        leaseOwner: "worker-1",
        leaseForSeconds: 60,
        limit: 10,
      });
      expect(claimed.map((r) => r.artifact_id)).toEqual(["a-due"]);
    });

    it("claimDueWaiting respects the lease — concurrent claims do not double-pick", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      await store.insertWaiting(row({ artifact_id: "a-1", expires_at: past }));

      const a = await store.claimDueWaiting({
        now: new Date().toISOString(),
        leaseOwner: "worker-A",
        leaseForSeconds: 60,
        limit: 10,
      });
      const b = await store.claimDueWaiting({
        now: new Date().toISOString(),
        leaseOwner: "worker-B",
        leaseForSeconds: 60,
        limit: 10,
      });
      expect(a.length).toBe(1);
      expect(b.length).toBe(0);
    });

    it("claimDueWaiting respects limit", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      for (let i = 0; i < 5; i++) {
        await store.insertWaiting(row({ artifact_id: `a-${i}`, expires_at: past }));
      }
      const claimed = await store.claimDueWaiting({
        now: new Date().toISOString(),
        leaseOwner: "worker-1",
        leaseForSeconds: 60,
        limit: 3,
      });
      expect(claimed.length).toBe(3);
    });

    it("countByStatus reports rough counts", async () => {
      await store.insertWaiting(row({ artifact_id: "a-1" }));
      await store.insertWaiting(row({ artifact_id: "a-2" }));
      await store.insertWaiting(row({ artifact_id: "a-3" }));
      await store.markTerminal("a-2", "reacted", "evt", new Date().toISOString());

      const counts = await store.countByStatus();
      expect(counts.waiting).toBe(2);
      expect(counts.reacted).toBe(1);
    });
  });
}
