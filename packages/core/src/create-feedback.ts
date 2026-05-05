import { ActionRegistry, type FeedbackActionDefinition } from "./registry/actions.js";
import { ArtifactTypeRegistry, type ArtifactTypeDefinition } from "./registry/artifact-types.js";
import { classify, type ClassifierContext } from "./classifier.js";
import { ProjectionEngine, type ProjectionBuilder } from "./projection-engine.js";
import type { EventStorePort } from "./ports/event-store-port.js";
import type { ProjectionStorePort } from "./ports/projection-store-port.js";
import type { FeedbackPort, RebuildResult } from "./ports/feedback-port.js";
import type { EventBusPort } from "./ports/event-bus-port.js";
import { topicsFor } from "./ports/event-bus-port.js";
import type { OutboxPort } from "./ports/outbox-port.js";
import type { InferenceRulesPort, InferenceRule } from "./ports/inference-rules-port.js";
import type { Middleware } from "./middleware/types.js";
import type { FeedbackEvent, CaptureInput, EventFilter, Provenance } from "./event-types.js";

export interface CreateFeedbackOptions {
  eventStore: EventStorePort;
  projectionStore: ProjectionStorePort;
  actions: FeedbackActionDefinition[];
  artifactTypes: ArtifactTypeDefinition[];
  projections?: ProjectionBuilder[];

  /** Optional event bus. When provided, events are published after commit. */
  eventBus?: EventBusPort;
  /**
   * Optional transactional outbox. When provided alongside eventBus, events
   * are enqueued in the same transaction as the event log append, and an
   * external scanner is responsible for actually publishing.
   *
   * Without an outbox, the framework publishes directly after commit, which
   * is best-effort (a process crash between commit and publish loses the bus
   * notification — but the event is still durable in the log).
   */
  outbox?: OutboxPort;
  /** Optional inference rules store. Loaded on capture for threshold-based classification. */
  inferenceRules?: InferenceRulesPort;
  /**
   * History window (ms) consulted when evaluating inference rules. Defaults
   * to 30 days. The framework reads recent events on the same partition
   * within this window and feeds them to the classifier.
   */
  historyWindowMs?: number;

  /**
   * Optional middleware applied to direct bus publishes (when no outbox is
   * configured). Composed in order: middlewares[0] wraps middlewares[1] etc.
   * The innermost handler calls eventBus.publish for each topic.
   */
  publishMiddleware?: Middleware<FeedbackEvent>[];

  /** Schema version emitted on new events. Defaults to 1. */
  currentSchemaVersion?: number;
  /** Default partition_key strategy when CaptureInput.partition_key is absent. */
  defaultPartitionKey?: (input: CaptureInput) => string;
  /** Optional ID generator (defaults to crypto.randomUUID). */
  generateEventId?: () => string;
}

/**
 * Compose the framework: stores + registries + projection engine + optional
 * bus/outbox/rules into a FeedbackPort.
 */
export function createFeedback(options: CreateFeedbackOptions): FeedbackPort {
  const actionRegistry = new ActionRegistry(options.actions);
  const artifactTypeRegistry = new ArtifactTypeRegistry(options.artifactTypes);
  const projectionEngine = new ProjectionEngine(options.projectionStore, options.projections ?? []);
  const schemaVersion = options.currentSchemaVersion ?? 1;
  const generateId = options.generateEventId ?? defaultIdGenerator;
  const partitionKey = options.defaultPartitionKey ?? ((input) => input.artifact_id);
  const historyWindowMs = options.historyWindowMs ?? 30 * 24 * 60 * 60 * 1000;

  // Build the publish pipeline once at composition time.
  const publishHandler = buildPublishHandler(options.eventBus, options.publishMiddleware);

  const port: FeedbackPort = {
    async capture(input: CaptureInput): Promise<string> {
      const action = actionRegistry.get(input.action);
      if (!artifactTypeRegistry.has(input.artifact_type)) {
        throw new Error(
          `Unknown artifact type: ${input.artifact_type}. Registered: ${artifactTypeRegistry
            .list()
            .map((t) => t.name)
            .join(", ")}`,
        );
      }

      const validatedPayload = action.payloadSchema.parse(input.payload);
      const pk = input.partition_key ?? partitionKey(input);

      // Load rules + history for the classifier (only when rules store provided).
      let rules: InferenceRule[] = [];
      let history: ReadonlyArray<{ action: string; timestamp: string }> = [];
      if (options.inferenceRules) {
        rules = await options.inferenceRules.list();
        if (rules.length > 0) {
          history = await loadHistory(options.eventStore, pk, historyWindowMs);
        }
      }

      const classifierContext: ClassifierContext = {
        task_type: input.task_type,
        producer: input.producer,
        artifact_type: input.artifact_type,
        rules,
        history,
      };
      const { polarity, inference } = classify(action, validatedPayload, classifierContext);

      const now = new Date().toISOString();
      const provenance: Provenance = {
        channel: input.provenance?.channel ?? "system",
        captured_by_adapter: input.provenance?.captured_by_adapter ?? "unknown",
        ...(input.provenance?.instance_id !== undefined && {
          instance_id: input.provenance.instance_id,
        }),
        ...(input.provenance?.latency_ms !== undefined && {
          latency_ms: input.provenance.latency_ms,
        }),
      };

      const event: FeedbackEvent = {
        event_id: generateId(),
        event_version: schemaVersion,
        timestamp: input.timestamp ?? now,
        captured_at: now,
        partition_key: pk,
        source: input.source ?? action.source,
        polarity,
        inference,
        action: input.action,
        artifact_type: input.artifact_type,
        artifact_id: input.artifact_id,
        artifact_version: input.artifact_version,
        producer: input.producer,
        task_type: input.task_type,
        payload: validatedPayload,
        provenance,
        ...(input.correction_of !== undefined && { correction_of: input.correction_of }),
        ...(input.correlates_with !== undefined && { correlates_with: input.correlates_with }),
      };

      // Durable + sync projections + outbox in one transaction.
      const topics = topicsFor(event);
      await options.eventStore.withTransaction(async (tx) => {
        await options.eventStore.append(event, tx);
        await projectionEngine.applySync(event, tx);
        if (options.outbox) {
          await options.outbox.enqueue(event, topics, tx);
        }
      });

      // After commit: publish (best-effort if no outbox; redundant-best-effort if outbox).
      if (options.eventBus && publishHandler) {
        if (options.outbox) {
          // Outbox is the authority; treat direct publish as a best-effort fast path.
          publishHandler(event).catch(() => {
            /* outbox scanner will retry */
          });
        } else {
          // No outbox: direct publish is the only delivery path. Errors propagate.
          await publishHandler(event);
        }
      }

      return event.event_id;
    },

    readStream(partitionKey: string, fromVersion?: number): AsyncIterable<FeedbackEvent> {
      return options.eventStore.readStream(partitionKey, fromVersion);
    },

    readAll(filter?: EventFilter, pageSize?: number): AsyncIterable<FeedbackEvent> {
      return options.eventStore.readAll(filter, pageSize);
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

/**
 * Build the post-commit publish handler. Composes user middleware around
 * a final handler that fans out to all topics for the event.
 */
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
  // Compose middlewares: [a, b, c] => a(b(c(final)))
  return middlewares.reduceRight<(event: FeedbackEvent) => Promise<void>>(
    (next, mw) => mw(next),
    finalHandler,
  );
}

/**
 * Load recent history for a partition within a window.
 *
 * For F2 we read the entire partition stream and filter in-memory by timestamp.
 * F3+ may add an EventStorePort.readStreamSince(...) for direct DB-side filtering.
 */
async function loadHistory(
  eventStore: EventStorePort,
  partitionKey: string,
  windowMs: number,
): Promise<Array<{ action: string; timestamp: string }>> {
  const cutoff = Date.now() - windowMs;
  const out: Array<{ action: string; timestamp: string }> = [];
  for await (const e of eventStore.readStream(partitionKey)) {
    const t = Date.parse(e.timestamp);
    if (Number.isNaN(t) || t < cutoff) continue;
    out.push({ action: e.action, timestamp: e.timestamp });
  }
  return out;
}

function defaultIdGenerator(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Last-resort fallback (should never run on supported Node versions)
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `evt-${ts}-${rand}`;
}
