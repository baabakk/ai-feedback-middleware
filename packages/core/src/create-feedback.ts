import { ActionRegistry, type FeedbackActionDefinition } from "./registry/actions.js";
import { ArtifactTypeRegistry, type ArtifactTypeDefinition } from "./registry/artifact-types.js";
import { evaluateReaction, DEFAULT_CLASSIFIER_VERSION } from "./classifier.js";
import { evaluateRules, type ActionabilityDecision } from "./inference-engine.js";
import { ProjectionEngine, type ProjectionBuilder } from "./projection-engine.js";
import type { EventStorePort } from "./ports/event-store-port.js";
import type { ProjectionStorePort } from "./ports/projection-store-port.js";
import type { CapturePort, RebuildResult } from "./ports/capture-port.js";
import type { EventBusPort } from "./ports/event-bus-port.js";
import { topicsFor, topicsForActionabilityDecision } from "./ports/event-bus-port.js";
import type { OutboxPort } from "./ports/outbox-port.js";
import type { ActionabilityRulesPort } from "./ports/actionability-rules-port.js";
import type { ActionabilityDecisionsStore } from "./ports/actionability-decisions-store-port.js";
import type { TrackedArtifactsPort } from "./ports/tracked-artifacts-port.js";
import type { Middleware } from "./middleware/types.js";
import type {
  ActionabilityFilter,
  ArtifactFilter,
  CancelArtifactInput,
  CaptureArtifactInput,
  CaptureArtifactResult,
  CapturedArtifactEvent,
  CapturedEvaluatedReactionEvent,
  CompetitiveSelectionInput,
  FeedbackEvent,
  Provenance,
  ReactionFilter,
  RecordReactionInput,
  RecordReactionResult,
  Source,
} from "./event-types.js";
import { type EventUpcaster, validateUpcasterChain } from "./upcaster.js";

/**
 * createFeedback composition options. See spec §6.1.
 */
export interface CreateFeedbackOptions {
  eventStore: EventStorePort;
  projectionStore: ProjectionStorePort;
  trackedArtifacts: TrackedArtifactsPort;
  actions: FeedbackActionDefinition[];
  artifactTypes: ArtifactTypeDefinition[];
  projections?: ProjectionBuilder[];

  /** Optional event bus. When provided, events are published after commit. */
  eventBus?: EventBusPort;
  /** Optional transactional outbox; when provided, drives publishing. */
  outbox?: OutboxPort;
  /** Optional actionability rules store, read by Layer 4 inline. */
  actionabilityRules?: ActionabilityRulesPort;
  /** Optional actionability decisions store. Required for inline Layer 4. */
  actionabilityDecisions?: ActionabilityDecisionsStore;
  /**
   * Sliding window (ms) consulted when evaluating actionability rules in
   * Layer 4. Defaults to 30 days. Adapter is responsible for indexing
   * `occurred_at` so the cutoff query is cheap.
   */
  actionabilityWindowMs?: number;

  /**
   * Optional middleware applied to direct bus publishes (when no outbox is
   * configured). Composed in order: middlewares[0] wraps middlewares[1] etc.
   */
  publishMiddleware?: Middleware<FeedbackEvent>[];

  /** Callback fired when post-commit publish fails (visibility). */
  onPublishError?: (event: FeedbackEvent, err: unknown) => void;

  /** Schema version emitted on new events. Defaults to 2 (2.1). */
  currentSchemaVersion?: number;

  /** Optional upcasters that translate older events to currentSchemaVersion. */
  upcasters?: EventUpcaster[];

  /** Default partition_key strategy. Defaults to `(input) => input.artifact_id`. */
  defaultPartitionKey?: (input: CaptureArtifactInput) => string;

  /** Optional ID generators (defaults to crypto.randomUUID). */
  generateEventId?: () => string;
  generateArtifactId?: () => string;

  /**
   * Identifier for the classifier rule pack used; embedded as
   * `classifier_version` on every reaction event. Defaults to
   * `DEFAULT_CLASSIFIER_VERSION`.
   */
  classifierVersion?: string;
}

/**
 * Compose the framework into a {@link CapturePort} consumer-facing facade.
 *
 * See spec §7 for API semantics and §11–§12 for layer responsibilities.
 */
export function createFeedback(options: CreateFeedbackOptions): CapturePort {
  const actionRegistry = new ActionRegistry(options.actions);
  const artifactTypeRegistry = new ArtifactTypeRegistry(options.artifactTypes);
  const projectionEngine = new ProjectionEngine(options.projectionStore, options.projections ?? []);
  const schemaVersion = options.currentSchemaVersion ?? 2;
  const upcasters = options.upcasters ?? [];
  validateUpcasterChain(upcasters, schemaVersion);
  const generateEventId = options.generateEventId ?? defaultIdGenerator("evt");
  const generateArtifactId = options.generateArtifactId ?? defaultIdGenerator("art");
  const partitionKey = options.defaultPartitionKey ?? ((input) => input.artifact_id ?? "");
  const classifierVersion = options.classifierVersion ?? DEFAULT_CLASSIFIER_VERSION;
  const actionabilityWindowMs = options.actionabilityWindowMs ?? 30 * 24 * 60 * 60 * 1000;

  const publishHandler = buildPublishHandler(options.eventBus, options.publishMiddleware);

  const port: CapturePort = {
    async captureArtifact(input: CaptureArtifactInput): Promise<CaptureArtifactResult> {
      if (!artifactTypeRegistry.has(input.artifact_type)) {
        throw new Error(
          `Unknown artifact type: ${input.artifact_type}. Registered: ${artifactTypeRegistry
            .list()
            .map((t) => t.name)
            .join(", ")}`,
        );
      }
      if (!input.expires_at) {
        throw new Error(
          `captureArtifact: expires_at is REQUIRED on every governed artifact. ` +
            `Set it to the deadline at which the Lifecycle Worker should fire ` +
            `silently_accepted or silently_rejected_expired per the artifact ` +
            `type's expirationPolicy.`,
        );
      }

      const artifact_id = input.artifact_id ?? generateArtifactId();
      const event_id = generateEventId();
      const now = new Date().toISOString();
      const occurred_at = input.occurred_at ?? now;
      const pk = input.partition_key ?? partitionKey({ ...input, artifact_id });
      const provenance = mergeProvenance(input.provenance);

      const event: CapturedArtifactEvent = {
        event_kind: "capture",
        event_id,
        event_version: schemaVersion,
        artifact_id,
        artifact_type: input.artifact_type,
        artifact_version: input.artifact_version,
        partition_key: pk,
        producer: input.producer,
        task_type: input.task_type,
        expires_at: input.expires_at,
        occurred_at,
        captured_at: now,
        payload: input.payload,
        provenance,
        ...(input.previous_artifact_id !== undefined && {
          previous_artifact_id: input.previous_artifact_id,
        }),
      };

      const topics = topicsFor(event);
      await options.eventStore.withTransaction(async (tx) => {
        await options.eventStore.append(event, tx);
        await options.trackedArtifacts.insertWaiting(
          {
            artifact_id,
            artifact_type: input.artifact_type,
            artifact_version: input.artifact_version,
            partition_key: pk,
            producer: input.producer,
            task_type: input.task_type,
            status: "waiting",
            expires_at: input.expires_at,
            created_at: now,
          },
          tx,
        );
        await projectionEngine.applySync(event, tx);
        if (options.outbox) {
          await options.outbox.enqueue(event, topics, artifact_id, tx);
        }
      });

      await publishAfterCommit(event, options, publishHandler);

      return { artifact_id, event_id, captured_at: now };
    },

    async recordReaction(input: RecordReactionInput): Promise<RecordReactionResult> {
      const action = actionRegistry.get(input.action);
      const tracked = await options.trackedArtifacts.getByArtifactId(input.artifact_id);
      if (!tracked) {
        throw new Error(
          `recordReaction: no tracked artifact for artifact_id=${input.artifact_id}. ` +
            `Call captureArtifact first to open the lifecycle.`,
        );
      }

      // Layer 3 — Reaction Evaluation, inline.
      const evaluations = evaluateReaction(
        action,
        input.payload,
        {
          classifier_version: classifierVersion,
          artifact_type: tracked.artifact_type,
        },
        input.evaluations_override,
      );

      const event_id = generateEventId();
      const now = new Date().toISOString();
      const occurred_at = input.occurred_at ?? now;
      const provenance = mergeProvenance(input.provenance);
      const source: Source = input.source_override ?? action.source;

      const reaction: CapturedEvaluatedReactionEvent = {
        event_kind: "reaction",
        event_id,
        event_version: schemaVersion,
        artifact_id: input.artifact_id,
        artifact_type: tracked.artifact_type,
        artifact_version: tracked.artifact_version,
        partition_key: tracked.partition_key,
        producer: tracked.producer,
        task_type: tracked.task_type,
        source,
        action: action.name,
        evaluations,
        classifier_version: classifierVersion,
        occurred_at,
        captured_at: now,
        payload: input.payload ?? {},
        provenance,
        ...(input.correction_of_event_id !== undefined && {
          correction_of_event_id: input.correction_of_event_id,
        }),
        ...(input.successor_artifact_id !== undefined && {
          successor_artifact_id: input.successor_artifact_id,
        }),
      };

      const terminalStatus = terminalStatusForAction(action.name);
      const topics = topicsFor(reaction);
      let inlineDecisions: ActionabilityDecision[] = [];

      await options.eventStore.withTransaction(async (tx) => {
        await options.eventStore.append(reaction, tx);
        if (terminalStatus) {
          await options.trackedArtifacts.markTerminal(
            input.artifact_id,
            terminalStatus,
            event_id,
            now,
            tx,
          );
        }
        await projectionEngine.applySync(reaction, tx);

        // Layer 4 — Actionable Result Inference, inline.
        if (options.actionabilityRules && options.actionabilityDecisions) {
          inlineDecisions = await runInlineLayer4(
            {
              reactionJustWritten: reaction,
              actionabilityRules: options.actionabilityRules,
              eventStore: options.eventStore,
              actionabilityWindowMs,
              now,
            },
            tx,
          );
          if (inlineDecisions.length > 0) {
            await options.actionabilityDecisions.appendBatch(inlineDecisions, tx);
          }
        }

        if (options.outbox) {
          await options.outbox.enqueue(reaction, topics, input.artifact_id, tx);
        }
      });

      await publishAfterCommit(reaction, options, publishHandler);

      // Per-axis inference topics — emit after commit so subscribers see only
      // durably-persisted decisions.
      if (options.eventBus && inlineDecisions.length > 0) {
        for (const decision of inlineDecisions) {
          const decisionTopics = topicsForActionabilityDecision({
            axis: decision.axis,
            inference: decision.inference,
            artifact_type: reaction.artifact_type,
          });
          for (const topic of decisionTopics) {
            // Decisions are not FeedbackEvents; we publish them as opaque
            // payloads so subscribers filtering on `feedback.inference.*`
            // can ingest. Adapters that strictly require FeedbackEvent on
            // their bus may filter these out; the topic prefix is canonical.
            void options.eventBus
              .publish(topic, decision as unknown as FeedbackEvent)
              .catch((err) => {
                if (options.onPublishError) {
                  options.onPublishError(decision as unknown as FeedbackEvent, err);
                }
              });
          }
        }
      }

      return { event_id, evaluations };
    },

    async cancelArtifact(input: CancelArtifactInput): Promise<{ event_id: string }> {
      const result = await port.recordReaction({
        artifact_id: input.artifact_id,
        action: "cancelled",
        payload: { reason: input.reason, ...(input.metadata ?? {}) },
        ...(input.occurred_at !== undefined && { occurred_at: input.occurred_at }),
      });
      return { event_id: result.event_id };
    },

    async recordCompetitiveSelection(
      input: CompetitiveSelectionInput,
    ): Promise<{ event_ids: string[] }> {
      if (!input.alternatives.includes(input.chosen)) {
        throw new Error(
          `recordCompetitiveSelection: chosen "${input.chosen}" is not in alternatives [${input.alternatives.join(", ")}]`,
        );
      }
      const event_ids: string[] = [];
      for (const candidate of input.alternatives) {
        const isChosen = candidate === input.chosen;
        const competitors = input.alternatives.filter((a) => a !== candidate);
        const action = isChosen ? "approved" : "not_selected_from_list";
        const result = await port.recordReaction({
          artifact_id: candidate,
          action,
          payload: {
            competitors,
            chosen: input.chosen,
            ...(input.selection_method !== undefined && {
              selection_method: input.selection_method,
            }),
            ...((input.payload as object | undefined) ?? {}),
          },
          ...(input.occurred_at !== undefined && { occurred_at: input.occurred_at }),
        });
        event_ids.push(result.event_id);
      }
      return { event_ids };
    },

    readCapturedArtifacts(filter?: ArtifactFilter): AsyncIterable<CapturedArtifactEvent> {
      const baseFilter = {
        event_kind: "capture" as const,
        ...(filter?.artifact_type !== undefined && { artifact_type: filter.artifact_type }),
        ...(filter?.producer !== undefined && { producer: filter.producer }),
        ...(filter?.task_type !== undefined && { task_type: filter.task_type }),
        ...(filter?.partition_key !== undefined && { partition_key: filter.partition_key }),
        ...(filter?.from_timestamp !== undefined && { from_timestamp: filter.from_timestamp }),
        ...(filter?.to_timestamp !== undefined && { to_timestamp: filter.to_timestamp }),
      };
      return filterIterable(
        options.eventStore.readAll(baseFilter),
        (e): e is CapturedArtifactEvent => e.event_kind === "capture",
      );
    },

    readReactions(filter?: ReactionFilter): AsyncIterable<CapturedEvaluatedReactionEvent> {
      const baseFilter = {
        event_kind: "reaction" as const,
        ...(filter?.source !== undefined && { source: filter.source }),
        ...(filter?.action !== undefined && { action: filter.action }),
        ...(filter?.artifact_type !== undefined && { artifact_type: filter.artifact_type }),
        ...(filter?.producer !== undefined && { producer: filter.producer }),
        ...(filter?.task_type !== undefined && { task_type: filter.task_type }),
        ...(filter?.partition_key !== undefined && { partition_key: filter.partition_key }),
        ...(filter?.from_timestamp !== undefined && { from_timestamp: filter.from_timestamp }),
        ...(filter?.to_timestamp !== undefined && { to_timestamp: filter.to_timestamp }),
      };
      const stream = filterIterable(
        options.eventStore.readAll(baseFilter),
        (e): e is CapturedEvaluatedReactionEvent => e.event_kind === "reaction",
      );
      // Optional client-side axis-polarity filter (cheap; adapter hint optional).
      if (filter?.axis_polarity) {
        const { axis, polarity } = filter.axis_polarity;
        return (async function* () {
          for await (const r of stream) {
            if (r.evaluations[axis] === polarity) yield r;
          }
        })();
      }
      return stream;
    },

    readActionableDecisions(
      filter?: ActionabilityFilter,
    ): AsyncIterable<ActionabilityDecision> {
      if (!options.actionabilityDecisions) {
        throw new Error(
          "readActionableDecisions: no ActionabilityDecisionsStore was wired. " +
            "Pass `actionabilityDecisions` to createFeedback() to enable Layer 4 reads.",
        );
      }
      return options.actionabilityDecisions.read(filter);
    },

    async rebuildProjection(name: string): Promise<RebuildResult> {
      const start = Date.now();
      const result = await projectionEngine.rebuild(name, options.eventStore.readAll());
      return {
        projectionName: name,
        eventsProcessed: result.eventsProcessed,
        durationMs: Date.now() - start,
      };
    },

    async queryProjection<T = unknown>(
      name: string,
      filter: unknown,
      pageSize = 100,
    ): Promise<T[]> {
      projectionEngine.builderByName(name);
      return options.projectionStore.list<T>(name, filter, pageSize);
    },
  };

  return port;
}

// ---------- Helpers -------------------------------------------------------

function mergeProvenance(input: Partial<Provenance> | undefined): Provenance {
  return {
    channel: input?.channel ?? "system",
    captured_by_adapter: input?.captured_by_adapter ?? "unknown",
    ...(input?.instance_id !== undefined && { instance_id: input.instance_id }),
    ...(input?.latency_ms !== undefined && { latency_ms: input.latency_ms }),
  };
}

/**
 * Map an action name to the terminal `tracked_artifacts.status` it implies.
 * Returns `null` for actions that do not transition the lifecycle (corrected,
 * regenerated, etc.).
 */
function terminalStatusForAction(
  action: string,
):
  | "reacted"
  | "silently_accepted"
  | "silently_rejected_expired"
  | "cancelled"
  | "superseded"
  | null {
  switch (action) {
    case "approved":
    case "manually_edited":
    case "rejected":
    case "not_selected_from_list":
    case "mute_triggered":
    case "manually_replaced":
    case "internally_unobserved_externally_completed":
      return "reacted";
    case "silently_accepted":
      return "silently_accepted";
    case "silently_rejected_expired":
      return "silently_rejected_expired";
    case "cancelled":
      return "cancelled";
    case "superseded_by":
      return "superseded";
    default:
      return null;
  }
}

function buildPublishHandler(
  eventBus: EventBusPort | undefined,
  middlewares: Middleware<FeedbackEvent>[] | undefined,
): ((event: FeedbackEvent) => Promise<void>) | null {
  if (!eventBus) return null;

  const finalHandler = async (event: FeedbackEvent): Promise<void> => {
    const topics = topicsFor(event);
    await Promise.all(topics.map((topic) => eventBus.publish(topic, event)));
  };

  if (!middlewares || middlewares.length === 0) {
    return finalHandler;
  }
  return middlewares.reduceRight<(event: FeedbackEvent) => Promise<void>>(
    (next, mw) => mw(next),
    finalHandler,
  );
}

function publishAfterCommit(
  event: FeedbackEvent,
  options: CreateFeedbackOptions,
  publishHandler: ((event: FeedbackEvent) => Promise<void>) | null,
): Promise<void> {
  if (!options.eventBus || !publishHandler) return Promise.resolve();
  if (options.outbox) {
    // Outbox is the authority. Direct publish is best-effort; failures surface
    // via onPublishError but do not throw — the outbox scanner will retry.
    return publishHandler(event).catch((err) => {
      if (options.onPublishError) options.onPublishError(event, err);
    });
  }
  return publishHandler(event).catch((err) => {
    if (options.onPublishError) options.onPublishError(event, err);
    throw err;
  });
}

async function* filterIterable<TIn, TOut extends TIn>(
  source: AsyncIterable<TIn>,
  predicate: (value: TIn) => value is TOut,
): AsyncIterable<TOut> {
  for await (const value of source) {
    if (predicate(value)) yield value;
  }
}

function defaultIdGenerator(prefix: string): () => string {
  return () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };
}

/**
 * Layer 4 inline computation. Loads recent reactions on the same partition,
 * collects tombstoned artifact ids, applies every active rule, and returns
 * the resulting decisions. Caller appends them inside the transaction.
 */
async function runInlineLayer4(
  ctx: {
    reactionJustWritten: CapturedEvaluatedReactionEvent;
    actionabilityRules: ActionabilityRulesPort;
    eventStore: EventStorePort;
    actionabilityWindowMs: number;
    now: string;
  },
  tx: unknown,
): Promise<ActionabilityDecision[]> {
  const rules = await ctx.actionabilityRules.list();
  const activeRules = rules.filter((r) => r.active);
  if (activeRules.length === 0) return [];

  const sinceMs = Date.parse(ctx.now) - ctx.actionabilityWindowMs;
  const since_timestamp = new Date(sinceMs).toISOString();

  const candidates = await ctx.eventStore.readRecentReactions({
    partition_key: ctx.reactionJustWritten.partition_key,
    artifact_type: ctx.reactionJustWritten.artifact_type,
    since_timestamp,
    tx,
  });

  // Include the just-written reaction; some adapters won't see it yet within
  // the same tx depending on isolation level.
  const seenIds = new Set(candidates.map((c) => c.event_id));
  if (!seenIds.has(ctx.reactionJustWritten.event_id)) {
    candidates.push(ctx.reactionJustWritten);
  }

  const candidateArtifactIds = Array.from(new Set(candidates.map((c) => c.artifact_id)));
  const tombstoned = await ctx.eventStore.readTombstonedArtifactIds({
    candidate_artifact_ids: candidateArtifactIds,
    tx,
  });

  return evaluateRules(activeRules, candidates, tombstoned, { now: ctx.now });
}
