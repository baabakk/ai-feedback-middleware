import { ActionRegistry, type FeedbackActionDefinition } from "./registry/actions.js";
import { ArtifactTypeRegistry, type ArtifactTypeDefinition } from "./registry/artifact-types.js";
import { classify } from "./classifier.js";
import { ProjectionEngine, type ProjectionBuilder } from "./projection-engine.js";
import type { EventStorePort } from "./ports/event-store-port.js";
import type { ProjectionStorePort } from "./ports/projection-store-port.js";
import type {
  FeedbackPort,
  RebuildResult,
  Unsubscribe as _Unsubscribe,
} from "./ports/feedback-port.js";
import type { FeedbackEvent, CaptureInput, EventFilter, Provenance } from "./event-types.js";

export interface CreateFeedbackOptions {
  eventStore: EventStorePort;
  projectionStore: ProjectionStorePort;
  actions: FeedbackActionDefinition[];
  artifactTypes: ArtifactTypeDefinition[];
  projections?: ProjectionBuilder[];
  /** Schema version emitted on new events. Defaults to 1. */
  currentSchemaVersion?: number;
  /** Default partition key strategy when CaptureInput.partition_key is absent. Defaults to artifact_id. */
  defaultPartitionKey?: (input: CaptureInput) => string;
  /** Optional ID generator (defaults to crypto.randomUUID). */
  generateEventId?: () => string;
}

/**
 * Compose the framework: stores + registries + projection engine into a FeedbackPort.
 *
 * This is the framework's main entry point.
 */
export function createFeedback(options: CreateFeedbackOptions): FeedbackPort {
  const actionRegistry = new ActionRegistry(options.actions);
  const artifactTypeRegistry = new ArtifactTypeRegistry(options.artifactTypes);
  const projectionEngine = new ProjectionEngine(options.projectionStore, options.projections ?? []);
  const schemaVersion = options.currentSchemaVersion ?? 1;
  const generateId = options.generateEventId ?? defaultIdGenerator;
  const partitionKey = options.defaultPartitionKey ?? ((input) => input.artifact_id);

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
      const { polarity, inference } = classify(action, validatedPayload);

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
        partition_key: input.partition_key ?? partitionKey(input),
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

      await options.eventStore.append(event);
      await projectionEngine.applySync(event);

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

function defaultIdGenerator(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Last-resort fallback (should never run on supported Node versions)
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `evt-${ts}-${rand}`;
}
