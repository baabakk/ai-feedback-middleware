import type {
  ActionabilityFilter,
  ArtifactFilter,
  CancelArtifactInput,
  CaptureArtifactInput,
  CaptureArtifactResult,
  CapturedArtifactEvent,
  CapturedEvaluatedReactionEvent,
  CompetitiveSelectionInput,
  RecordReactionInput,
  RecordReactionResult,
  ReactionFilter,
} from "../event-types.js";
import type { ActionabilityDecision } from "../inference-engine.js";

export interface RebuildResult {
  projectionName: string;
  eventsProcessed: number;
  durationMs: number;
}

export type Unsubscribe = () => Promise<void>;

/**
 * The framework's public consumer-facing facade. `createFeedback({...})`
 * returns an instance of `CapturePort`.
 *
 * The capture surface is split into four methods (per spec §7) — the
 * unified `capture()` from earlier drafts is gone. Reads are exposed via
 * three iterator methods that target the three immutable tables.
 *
 * See spec §8.1 and architecture §35.
 */
export interface CapturePort {
  // ----- Layer 1 capture boundaries ----------------------------------------

  /**
   * Open a governed lifecycle for an artifact.
   * Appends one row to `captured_artifacts` and one row to `tracked_artifacts`
   * (status='waiting'). Writes one outbox row.
   */
  captureArtifact(input: CaptureArtifactInput): Promise<CaptureArtifactResult>;

  /**
   * Append a reaction to an existing artifact. Per-axis evaluations are
   * computed inline by Layer 3 (Reaction Evaluation) and embedded as columns
   * on the same row. Triggers Layer 4 (Actionable Result Inference) inline.
   */
  recordReaction(input: RecordReactionInput): Promise<RecordReactionResult>;

  /**
   * Append a `cancelled` tombstone reaction. Transitions
   * `tracked_artifacts.status` to `cancelled`. Layer 4 will exclude this
   * artifact from future rule runs.
   */
  cancelArtifact(input: CancelArtifactInput): Promise<{ event_id: string }>;

  /**
   * Fan out to N reactions in one transaction for the comparative-selection
   * idiom: one `approved` reaction on the chosen artifact and one
   * `not_selected_from_list` reaction on each non-chosen alternative.
   */
  recordCompetitiveSelection(input: CompetitiveSelectionInput): Promise<{ event_ids: string[] }>;

  // ----- Read methods -------------------------------------------------------

  readCapturedArtifacts(filter?: ArtifactFilter): AsyncIterable<CapturedArtifactEvent>;
  readReactions(filter?: ReactionFilter): AsyncIterable<CapturedEvaluatedReactionEvent>;
  readActionableDecisions(filter?: ActionabilityFilter): AsyncIterable<ActionabilityDecision>;

  // ----- Admin operations ---------------------------------------------------

  rebuildProjection(name: string): Promise<RebuildResult>;
  queryProjection<T = unknown>(name: string, filter: unknown, pageSize?: number): Promise<T[]>;
}

/**
 * @deprecated Use {@link CapturePort}. The v1 `FeedbackPort` exposed a
 * unified `capture()` method that is gone in 2.1. Retained as an alias only
 * so consumer imports continue resolving during the v0.2.x → v0.3.x bump.
 */
export type FeedbackPort = CapturePort;
