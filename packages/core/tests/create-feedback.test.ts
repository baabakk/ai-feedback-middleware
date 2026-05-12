import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  acceptByDefault,
  registerAction,
  type CapturedArtifactEvent,
  type CapturedEvaluatedReactionEvent,
  type EventFilter,
  type EventStorePort,
  type FeedbackEvent,
  type ProjectionBuilder,
  type ProjectionStorePort,
  type TrackedArtifactsPort,
  type TrackedArtifactRow,
  type TrackedArtifactStatus,
} from "../src/index.js";

// Minimal in-memory adapters here so core can be tested standalone (no dep on
// @in-memory package).

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
    async *readAll(filter?: EventFilter) {
      for (const e of events) {
        if (filter?.event_kind && e.event_kind !== filter.event_kind) continue;
        if (filter?.action) {
          if (e.event_kind !== "reaction" || e.action !== filter.action) continue;
        }
        yield e;
      }
    },
    subscribeAll(_h) {
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

function makeProjectionStore(): ProjectionStorePort {
  const data = new Map<string, Map<string, unknown>>();
  const checkpoints = new Map<string, string>();
  function bucket(p: string): Map<string, unknown> {
    let m = data.get(p);
    if (!m) {
      m = new Map();
      data.set(p, m);
    }
    return m;
  }
  return {
    async get<T = unknown>(p: string, k: string): Promise<T | null> {
      return ((data.get(p)?.get(k) as T) ?? null) as T | null;
    },
    async put<T = unknown>(p: string, k: string, s: T, _e: string) {
      bucket(p).set(k, s);
    },
    async list<T = unknown>(p: string, _f: unknown, _ps: number): Promise<T[]> {
      return Array.from(data.get(p)?.values() ?? []) as T[];
    },
    async checkpoint(p: string) {
      return checkpoints.get(p) ?? null;
    },
    async setCheckpoint(p: string, e: string) {
      checkpoints.set(p, e);
    },
    async truncate(p: string) {
      data.delete(p);
      checkpoints.delete(p);
    },
  };
}

function makeTrackedArtifacts(): TrackedArtifactsPort {
  const rows = new Map<string, TrackedArtifactRow>();
  return {
    async insertWaiting(row) {
      rows.set(row.artifact_id, { ...row });
    },
    async getByArtifactId(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async markTerminal(id, status, terminal_reaction_event_id, terminal_status_at) {
      const r = rows.get(id);
      if (!r) return;
      if (r.status !== "waiting") return;
      r.status = status;
      r.terminal_reaction_event_id = terminal_reaction_event_id;
      r.terminal_status_at = terminal_status_at;
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
    projectionStore: makeProjectionStore(),
    trackedArtifacts: makeTrackedArtifacts(),
  };
}

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

describe("captureArtifact", () => {
  it("opens a lifecycle and writes a captured_artifacts row", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });

    const result = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_version: 1,
      producer: "secretary-agent",
      task_type: "outbound:warm_intro",
      payload: { artifact_hash: "sha256:abc" },
      expires_at: FUTURE,
    });

    expect(result.artifact_id).toBeTruthy();
    expect(result.event_id).toBeTruthy();
    expect(result.captured_at).toBeTruthy();

    const captures: CapturedArtifactEvent[] = [];
    for await (const c of feedback.readCapturedArtifacts({ artifact_type: "draft_email" })) {
      captures.push(c);
    }
    expect(captures).toHaveLength(1);
    expect(captures[0]!.event_kind).toBe("capture");
    expect(captures[0]!.expires_at).toBe(FUTURE);
  });

  it("uses provided artifact_id when supplied", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });

    const result = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: "explicit-id",
      artifact_version: 1,
      producer: "p",
      task_type: "t",
      payload: {},
      expires_at: FUTURE,
    });
    expect(result.artifact_id).toBe("explicit-id");
  });

  it("throws on unknown artifact_type", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });

    await expect(
      feedback.captureArtifact({
        artifact_type: "search_result",
        artifact_version: 1,
        producer: "p",
        task_type: "t",
        payload: {},
        expires_at: FUTURE,
      }),
    ).rejects.toThrow(/Unknown artifact type/);
  });

  it("throws when expires_at is missing", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });
    await expect(
      feedback.captureArtifact({
        artifact_type: "draft_email",
        artifact_version: 1,
        producer: "p",
        task_type: "t",
        payload: {},
        expires_at: "" as never,
      }),
    ).rejects.toThrow(/expires_at is REQUIRED/);
  });

  it("rejects an artifact-type registration without expirationPolicy", () => {
    expect(() =>
      createFeedback({
        ...deps(),
        actions: DEFAULT_ACTIONS,
        artifactTypes: [{ name: "ill-formed" } as never],
      }),
    ).toThrow(/expirationPolicy/);
  });
});

describe("recordReaction", () => {
  it("appends a reaction with per-axis evaluation embedded", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });
    const { artifact_id } = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_version: 1,
      producer: "p",
      task_type: "t",
      payload: {},
      expires_at: FUTURE,
    });

    const reaction = await feedback.recordReaction({
      artifact_id,
      action: "approved",
      payload: { actor_id: "babak" },
    });

    expect(reaction.event_id).toBeTruthy();
    expect(reaction.evaluations).toEqual({
      detection: "positive",
      content: "positive",
      timing: "positive",
      channel: "positive",
    });
  });

  it("supports per-event evaluations override", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });
    const { artifact_id } = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_version: 1,
      producer: "p",
      task_type: "t",
      payload: {},
      expires_at: FUTURE,
    });

    const reaction = await feedback.recordReaction({
      artifact_id,
      action: "approved",
      payload: { actor_id: "babak" },
      evaluations_override: { channel: "negative" },
    });
    expect(reaction.evaluations.channel).toBe("negative");
    expect(reaction.evaluations.content).toBe("positive");
  });

  it("throws on unknown action", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });
    const { artifact_id } = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_version: 1,
      producer: "p",
      task_type: "t",
      payload: {},
      expires_at: FUTURE,
    });
    await expect(
      feedback.recordReaction({ artifact_id, action: "starred" }),
    ).rejects.toThrow(/Unknown action: starred/);
  });

  it("throws when artifact_id was never captured", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });
    await expect(
      feedback.recordReaction({ artifact_id: "never-captured", action: "approved" }),
    ).rejects.toThrow(/no tracked artifact/);
  });

  it("supports custom action registration via registerAction()", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: [
        ...DEFAULT_ACTIONS,
        registerAction({
          name: "starred",
          source: "explicit",
          defaultEvaluations: { detection: "positive", content: "positive" },
          payloadSchema: z.object({}),
        }),
      ],
      artifactTypes: [rejectByDefault("draft_email")],
    });
    const { artifact_id } = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_version: 1,
      producer: "p",
      task_type: "t",
      payload: {},
      expires_at: FUTURE,
    });
    const r = await feedback.recordReaction({ artifact_id, action: "starred" });
    expect(r.evaluations).toEqual({ detection: "positive", content: "positive" });
  });
});

describe("cancelArtifact", () => {
  it("appends a cancelled tombstone reaction", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });
    const { artifact_id } = await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_version: 1,
      producer: "p",
      task_type: "t",
      payload: {},
      expires_at: FUTURE,
    });
    const result = await feedback.cancelArtifact({
      artifact_id,
      reason: "duplicate",
    });
    expect(result.event_id).toBeTruthy();

    const reactions: CapturedEvaluatedReactionEvent[] = [];
    for await (const r of feedback.readReactions()) reactions.push(r);
    expect(reactions.find((r) => r.action === "cancelled")).toBeTruthy();
  });
});

describe("recordCompetitiveSelection", () => {
  it("fans out to N reactions: chosen approved, others not_selected_from_list", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [acceptByDefault("draft_variant")],
    });
    for (const id of ["a", "b", "c"]) {
      await feedback.captureArtifact({
        artifact_type: "draft_variant",
        artifact_id: id,
        artifact_version: 1,
        producer: "p",
        task_type: "t",
        payload: {},
        expires_at: FUTURE,
      });
    }

    const result = await feedback.recordCompetitiveSelection({
      alternatives: ["a", "b", "c"],
      chosen: "b",
      selection_method: "user_pick",
    });
    expect(result.event_ids).toHaveLength(3);

    const reactions: CapturedEvaluatedReactionEvent[] = [];
    for await (const r of feedback.readReactions()) reactions.push(r);
    const approved = reactions.find((r) => r.action === "approved");
    expect(approved?.artifact_id).toBe("b");
    const notSelected = reactions.filter((r) => r.action === "not_selected_from_list");
    expect(notSelected.map((r) => r.artifact_id).sort()).toEqual(["a", "c"]);
  });

  it("throws when chosen is not in alternatives", async () => {
    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
    });
    await expect(
      feedback.recordCompetitiveSelection({
        alternatives: ["a", "b"],
        chosen: "c",
      }),
    ).rejects.toThrow(/not in alternatives/);
  });
});

describe("projections", () => {
  it("applies sync projections during recordReaction", async () => {
    type CounterState = { count: number };
    const counter: ProjectionBuilder<CounterState> = {
      name: "approval_counter",
      mode: "sync",
      applies: (e) => e.event_kind === "reaction" && e.action === "approved",
      keyFor: () => "global", // single bucket so multiple artifacts roll up
      apply: (_e, current) => ({ count: (current?.count ?? 0) + 1 }),
    };

    const feedback = createFeedback({
      ...deps(),
      actions: DEFAULT_ACTIONS,
      artifactTypes: [rejectByDefault("draft_email")],
      projections: [counter],
    });

    for (const id of ["a", "b"]) {
      const { artifact_id } = await feedback.captureArtifact({
        artifact_type: "draft_email",
        artifact_id: id,
        artifact_version: 1,
        producer: "p",
        task_type: "t",
        payload: {},
        expires_at: FUTURE,
      });
      await feedback.recordReaction({ artifact_id, action: "approved" });
    }

    const counts = await feedback.queryProjection<CounterState>("approval_counter", undefined);
    expect(counts).toHaveLength(1);
    expect(counts[0]!.count).toBe(2);
  });
});
