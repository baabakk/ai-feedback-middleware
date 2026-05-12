import { describe, it, expect } from "vitest";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  type ActionabilityRulesPort,
  type ActionabilityDecisionsStore,
  type CapturedEvaluatedReactionEvent,
  type EventBusPort,
  type EventStorePort,
  type FeedbackEvent,
  type ProjectionStorePort,
  type TrackedArtifactRow,
  type TrackedArtifactStatus,
  type TrackedArtifactsPort,
} from "../src/index.js";

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function makeStore(): EventStorePort {
  const events: FeedbackEvent[] = [];
  return {
    async withTransaction(work) {
      return work(undefined);
    },
    async append(e) {
      events.push(e);
    },
    async appendBatch(b) {
      events.push(...b);
    },
    async *readStream(pk) {
      for (const e of events.filter((x) => x.partition_key === pk)) yield e;
    },
    async *readStreamSince(pk, since) {
      const cutoff = Date.parse(since);
      for (const e of events.filter((x) => x.partition_key === pk)) {
        const t = Date.parse(e.occurred_at);
        if (!Number.isNaN(t) && t >= cutoff) yield e;
      }
    },
    async *readAll() {
      for (const e of events) yield e;
    },
    subscribeAll() {
      return async () => {};
    },
    async readRecentReactions() {
      return events.filter((e): e is CapturedEvaluatedReactionEvent => e.event_kind === "reaction");
    },
    async readTombstonedArtifactIds() {
      return new Set<string>();
    },
  };
}

function makeProjStore(): ProjectionStorePort {
  return {
    async get() {
      return null;
    },
    async put() {},
    async list() {
      return [];
    },
    async checkpoint() {
      return null;
    },
    async setCheckpoint() {},
    async truncate() {},
  };
}

function makeTrackedArtifacts(): TrackedArtifactsPort {
  const rows = new Map<string, TrackedArtifactRow>();
  return {
    async insertWaiting(r) {
      rows.set(r.artifact_id, { ...r });
    },
    async getByArtifactId(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async markTerminal(id, status, eid, at) {
      const r = rows.get(id);
      if (!r || r.status !== "waiting") return;
      r.status = status;
      r.terminal_reaction_event_id = eid;
      r.terminal_status_at = at;
    },
    async claimDueWaiting() {
      return [];
    },
    async countByStatus() {
      const out: Partial<Record<TrackedArtifactStatus, number>> = {};
      for (const r of rows.values()) out[r.status] = (out[r.status] ?? 0) + 1;
      return out;
    },
  };
}

function deps() {
  return {
    eventStore: makeStore(),
    projectionStore: makeProjStore(),
    trackedArtifacts: makeTrackedArtifacts(),
  };
}

function makeFailingBus(): EventBusPort {
  return {
    async publish() {
      throw new Error("bus is down");
    },
    async subscribe() {
      return async () => {};
    },
  };
}

describe("onPublishError observability", () => {
  it("fires onPublishError when direct publish fails (with outbox)", async () => {
    const errors: Array<{ event: FeedbackEvent; err: unknown }> = [];

    const enqueued: FeedbackEvent[] = [];
    const fakeOutbox = {
      async enqueue(event: FeedbackEvent) {
        enqueued.push(event);
      },
      async pickUnpublished() {
        return [];
      },
      async markPublished() {},
      async markFailed() {},
      async backlogSize() {
        return 0;
      },
      async oldestUnpublishedAgeMs() {
        return null;
      },
    };

    const feedback = createFeedback({
      ...deps(),
      eventBus: makeFailingBus(),
      outbox: fakeOutbox,
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
      onPublishError: (event, err) => {
        errors.push({ event, err });
      },
    });

    await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "t",
      task_type: "t",
      payload: {},
      expires_at: FUTURE,
    });

    // Wait one tick for the fire-and-forget catch.
    await new Promise((r) => setTimeout(r, 50));

    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0]!.err as Error).message).toBe("bus is down");
    expect(enqueued.length).toBe(1);
  });

  it("fires onPublishError AND throws when no outbox is configured", async () => {
    const errors: unknown[] = [];

    const feedback = createFeedback({
      ...deps(),
      eventBus: makeFailingBus(),
      // No outbox
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
      onPublishError: (_event, err) => {
        errors.push(err);
      },
    });

    await expect(
      feedback.captureArtifact({
        artifact_type: "draft_email",
        artifact_id: "a-1",
        artifact_version: 1,
        producer: "t",
        task_type: "t",
        payload: {},
        expires_at: FUTURE,
      }),
    ).rejects.toThrow("bus is down");

    // Wait for fire-and-forget catch (publishAfterCommit).
    await new Promise((r) => setTimeout(r, 50));
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe("inline Layer 4 — actionability decisions", () => {
  it("emits decisions when threshold is crossed within the window", async () => {
    const decisions: ActionabilityDecisionsStore["appendBatch"] extends (b: infer T) => unknown
      ? T extends Array<infer D>
        ? D[]
        : never
      : never = [] as never;

    const decisionsStore: ActionabilityDecisionsStore = {
      async appendBatch(batch) {
        (decisions as unknown[]).push(...batch);
      },
      async *read() {
        for (const d of decisions as unknown[]) {
          yield d as never;
        }
      },
    };

    const rules: ActionabilityRulesPort = {
      async list() {
        return [
          {
            rule_id: "regenerate_burst",
            rule_version: "1",
            applies_when: { action: "regenerated" },
            axis: "content",
            threshold: 3,
            window_ms: 60_000,
            result_if_met: "actionable_negative",
            active: true,
          },
        ];
      },
      async upsert() {},
      async remove() {},
    };

    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
      actionabilityRules: rules,
      actionabilityDecisions: decisionsStore,
    });

    const cap = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: "a-1",
      artifact_version: 1,
      producer: "p",
      task_type: "t",
      payload: {},
      expires_at: FUTURE,
    });

    // Three regenerated reactions in quick succession should crystallize.
    await feedback.recordReaction({ artifact_id: cap.artifact_id, action: "regenerated" });
    await feedback.recordReaction({ artifact_id: cap.artifact_id, action: "regenerated" });
    await feedback.recordReaction({ artifact_id: cap.artifact_id, action: "regenerated" });

    expect((decisions as unknown[]).length).toBeGreaterThanOrEqual(1);
    const first = (decisions as unknown[])[0] as {
      axis: string;
      inference: string;
      artifact_id: string;
    };
    expect(first.axis).toBe("content");
    expect(first.inference).toBe("actionable_negative");
    expect(first.artifact_id).toBe("a-1");
  });
});
