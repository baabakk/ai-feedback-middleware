import { z } from "zod";

/**
 * Schema v2.1 — multi-axis polarity model.
 *
 * A captured artifact is the registration of a governed lifecycle (the
 * `captured_artifacts` row). A captured-evaluated reaction is something that
 * happened to that artifact (user reaction, framework deadline emission, or
 * tombstone), with per-axis polarity embedded inline by Layer 3.
 *
 * See `A02-Feedback-Middleware-Framework-Spec.md` §3-§10 for the spec, and
 * `Architecture V2, feedback_capture_middleware_architecture.md` §28-§40 for
 * the design-decision audit trail.
 */

// ---------- Source ---------------------------------------------------------

/**
 * `explicit` — user took a direct action.
 * `implicit` — framework or scan adapter derived without direct user action.
 * `meta`     — operational tombstone (`cancelled` / `corrected` / `superseded_by`).
 */
export type Source = "explicit" | "implicit" | "meta";

export const SourceSchema = z.enum(["explicit", "implicit", "meta"]);

// ---------- Axes & per-axis polarity --------------------------------------

/**
 * Four orthogonal evaluation axes. Every reaction is implicitly evaluating
 * up to four independent system decisions; the framework records them
 * separately rather than collapsing into a single scalar polarity.
 */
export type Axis = "detection" | "content" | "timing" | "channel";

export const AxisSchema = z.enum(["detection", "content", "timing", "channel"]);

/**
 * Per-axis polarity. Three states recorded as two values + absence:
 *  - `positive`  — direct evidence supports this axis.
 *  - `negative`  — direct evidence opposes this axis.
 *  - axis omitted from the row — no signal on this axis.
 *
 * No `neutral`, no `unknown`, no `not_applicable`. Absence on an axis is
 * absence of signal, not a fourth value.
 */
export type AxisPolarity = "positive" | "negative";

export const AxisPolaritySchema = z.enum(["positive", "negative"]);

/**
 * Per-axis evaluation vector. Optional fields by design — an axis with no
 * signal is simply absent from the record.
 */
export const EvaluationVectorSchema = z.object({
  detection: AxisPolaritySchema.optional(),
  content: AxisPolaritySchema.optional(),
  timing: AxisPolaritySchema.optional(),
  channel: AxisPolaritySchema.optional(),
});

export type EvaluationVector = z.infer<typeof EvaluationVectorSchema>;

// ---------- Per-axis actionability inference ------------------------------

/**
 * Layer 4 (Actionable Result Inference) output values, computed per axis.
 *
 *  - `actionable_positive` — enough evidence to act on this axis as positive.
 *  - `actionable_negative` — enough evidence to act on this axis as negative.
 *  - `continue_to_observe` — insufficient evidence; keep accumulating.
 *
 * The rename from `whitelist` / `blacklist` / `observe` (v1) is deliberate:
 * those names collided with the per-artifact-type `accepted_by_default` /
 * `rejected_by_default` policy values. `continue_to_observe` makes the
 * recurring-state semantics explicit: it is an instruction to keep watching.
 */
export type AxisInference =
  | "actionable_positive"
  | "actionable_negative"
  | "continue_to_observe";

export const AxisInferenceSchema = z.enum([
  "actionable_positive",
  "actionable_negative",
  "continue_to_observe",
]);

// ---------- Provenance ----------------------------------------------------

export const ProvenanceSchema = z.object({
  channel: z.string(),
  instance_id: z.string().optional(),
  latency_ms: z.number().optional(),
  captured_by_adapter: z.string(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

// ---------- Captured artifact event ---------------------------------------

/**
 * A captured-artifact event represents the entry of a governed artifact into
 * the framework's lifecycle. Immutable. One row per artifact in
 * `captured_artifacts`.
 */
export const CapturedArtifactEventSchema = z.object({
  event_kind: z.literal("capture"),

  event_id: z.string(),
  event_version: z.number().int().positive(),

  artifact_id: z.string(),
  artifact_type: z.string(),
  artifact_version: z.number().int().nonnegative(),
  partition_key: z.string(),
  producer: z.string(),
  task_type: z.string(),

  /**
   * REQUIRED. The lifecycle deadline; the Lifecycle Worker uses this to
   * decide when to emit `silently_accepted` or `silently_rejected_expired`
   * per the artifact type's `expirationPolicy`.
   */
  expires_at: z.string(),

  occurred_at: z.string(),
  captured_at: z.string(),

  payload: z.unknown(),
  provenance: ProvenanceSchema,

  /**
   * Optional pointer to a prior artifact this one supersedes (companion to
   * a `superseded_by` reaction on the predecessor).
   */
  previous_artifact_id: z.string().optional(),
});

export type CapturedArtifactEvent = z.infer<typeof CapturedArtifactEventSchema>;

// ---------- Captured-evaluated reaction event -----------------------------

/**
 * A captured-evaluated-reaction event represents something that happened to
 * a captured artifact: a user reaction, an implicit framework-driven
 * reaction (deadline-emission), or a tombstone (`cancelled` / `corrected` /
 * `superseded_by`). Immutable. Per-axis polarity is computed inline by
 * Layer 3 (Reaction Evaluation) and embedded as columns on the same row.
 */
export const CapturedEvaluatedReactionEventSchema = z.object({
  event_kind: z.literal("reaction"),

  event_id: z.string(),
  event_version: z.number().int().positive(),

  artifact_id: z.string(),
  artifact_type: z.string(),
  artifact_version: z.number().int().nonnegative(),
  partition_key: z.string(),
  producer: z.string(),
  task_type: z.string(),

  source: SourceSchema,
  action: z.string(),

  /**
   * Layer 3 (Reaction Evaluation) output, embedded inline. Per-axis polarity
   * is computed at write time from the action's default heuristics plus any
   * consumer-supplied override.
   */
  evaluations: EvaluationVectorSchema,

  /**
   * Identifier of the classifier rule pack used to compute `evaluations`.
   * Allows the framework to evolve classifier rules without retroactively
   * mutating prior reactions.
   */
  classifier_version: z.string(),

  occurred_at: z.string(),
  captured_at: z.string(),

  payload: z.unknown(),
  provenance: ProvenanceSchema,

  /**
   * Tombstone references (only on `corrected` / `cancelled` / `superseded_by`
   * actions; see §14 of the spec).
   */
  correction_of_event_id: z.string().optional(),
  successor_artifact_id: z.string().optional(),
});

export type CapturedEvaluatedReactionEvent = z.infer<
  typeof CapturedEvaluatedReactionEventSchema
>;

// ---------- Discriminated union -------------------------------------------

export const FeedbackEventSchema = z.discriminatedUnion("event_kind", [
  CapturedArtifactEventSchema,
  CapturedEvaluatedReactionEventSchema,
]);

export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;

// ---------- Capture / reaction inputs -------------------------------------

/**
 * Input for `captureArtifact()`. Opens a governed lifecycle.
 */
export interface CaptureArtifactInput {
  artifact_type: string;
  artifact_id?: string;
  artifact_version: number;
  producer: string;
  task_type: string;
  payload: unknown;
  /** REQUIRED. ISO 8601 timestamp at which the lifecycle worker should fire silently_*. */
  expires_at: string;
  partition_key?: string;
  provenance?: Partial<Provenance>;
  occurred_at?: string;
  previous_artifact_id?: string;
  metadata?: Record<string, unknown>;
}

export interface CaptureArtifactResult {
  artifact_id: string;
  event_id: string;
  captured_at: string;
}

/**
 * Input for `recordReaction()`. Closes a governed lifecycle (or appends a
 * tombstone). Always references an existing `artifact_id`.
 */
export interface RecordReactionInput {
  artifact_id: string;
  action: string;
  payload?: unknown;
  occurred_at?: string;
  /**
   * Optional per-event override of the per-axis evaluations. When provided,
   * overrides the action's default heuristics. Pass `undefined` for an axis
   * to keep the action default; pass an explicit `positive`/`negative` to
   * override; omit the key entirely to keep the action default.
   */
  evaluations_override?: Partial<EvaluationVector>;
  source_override?: Source;
  provenance?: Partial<Provenance>;
  /** Tombstone target. Required when `action === "corrected"`. */
  correction_of_event_id?: string;
  /** Tombstone target. Required when `action === "superseded_by"`. */
  successor_artifact_id?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordReactionResult {
  event_id: string;
  evaluations: EvaluationVector;
}

/**
 * Input for `cancelArtifact()`. Convenience wrapper around `recordReaction`
 * with `action="cancelled"`.
 */
export interface CancelArtifactInput {
  artifact_id: string;
  reason: "user_cancelled" | "duplicate" | "stale" | "other" | string;
  occurred_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Input for `recordCompetitiveSelection()`. Fans out to N reactions in one
 * transaction, recording one `approved` reaction on the chosen artifact and
 * one `not_selected_from_list` reaction on each non-chosen artifact.
 */
export interface CompetitiveSelectionInput {
  alternatives: string[];
  chosen: string;
  selection_method?: "user_pick" | "scoring_tiebreak" | "policy" | string;
  payload?: unknown;
  occurred_at?: string;
  metadata?: Record<string, unknown>;
}

// ---------- Read-side filters ---------------------------------------------

/**
 * Generic event filter used by the low-level `EventStorePort.readAll` to
 * scan across both event kinds. Higher-level reads use the more specific
 * {@link ArtifactFilter}, {@link ReactionFilter}, and
 * {@link ActionabilityFilter} types.
 */
export interface EventFilter {
  /** Restrict to one event kind. Omit to scan both. */
  event_kind?: "capture" | "reaction";
  source?: Source;
  action?: string;
  artifact_type?: string;
  artifact_id?: string;
  producer?: string;
  task_type?: string;
  partition_key?: string;
  from_timestamp?: string;
  to_timestamp?: string;
}

export interface ArtifactFilter {
  artifact_type?: string;
  producer?: string;
  task_type?: string;
  partition_key?: string;
  from_timestamp?: string;
  to_timestamp?: string;
}

export interface ReactionFilter extends ArtifactFilter {
  source?: Source;
  action?: string;
  /** Filter by polarity on a specific axis. */
  axis_polarity?: { axis: Axis; polarity: AxisPolarity };
}

export interface ActionabilityFilter {
  artifact_type?: string;
  producer?: string;
  task_type?: string;
  axis?: Axis;
  inference?: AxisInference;
  rule_id?: string;
  from_timestamp?: string;
  to_timestamp?: string;
}

// ---------- Legacy compatibility re-exports (deprecated) ------------------

/**
 * @deprecated Use {@link AxisPolarity} (per-axis) instead. The flat
 * `Polarity` type from v1 collapsed four orthogonal axes into one scalar.
 * Retained only for upcaster code that translates v1 → v2.1.
 */
export type Polarity = "positive" | "negative" | "neutral";

/**
 * @deprecated Use {@link AxisInference} (per-axis) instead. The v1 names
 * `whitelist` / `blacklist` / `observe` collided with the per-artifact-type
 * policy values. Retained only for upcaster code translating v1 → v2.1.
 */
export type Inference = "whitelist" | "blacklist" | "observe";
