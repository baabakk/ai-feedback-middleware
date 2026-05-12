// ---------- Event types (v2.1 schema) -------------------------------------

export {
  // Schemas
  FeedbackEventSchema,
  CapturedArtifactEventSchema,
  CapturedEvaluatedReactionEventSchema,
  EvaluationVectorSchema,
  ProvenanceSchema,
  AxisSchema,
  AxisPolaritySchema,
  AxisInferenceSchema,
  SourceSchema,
  // Types
  type FeedbackEvent,
  type CapturedArtifactEvent,
  type CapturedEvaluatedReactionEvent,
  type EvaluationVector,
  type Axis,
  type AxisPolarity,
  type AxisInference,
  type Source,
  type Provenance,
  // API inputs / outputs
  type CaptureArtifactInput,
  type CaptureArtifactResult,
  type RecordReactionInput,
  type RecordReactionResult,
  type CancelArtifactInput,
  type CompetitiveSelectionInput,
  // Filters
  type EventFilter,
  type ArtifactFilter,
  type ReactionFilter,
  type ActionabilityFilter,
  // Deprecated v1 aliases (upcaster only)
  type Polarity,
  type Inference,
} from "./event-types.js";

// ---------- Registries ----------------------------------------------------

export {
  ActionRegistry,
  registerAction,
  type FeedbackActionDefinition,
} from "./registry/actions.js";
export {
  ArtifactTypeRegistry,
  acceptByDefault,
  rejectByDefault,
  type ArtifactTypeDefinition,
  type ExpirationPolicy,
  type RetentionPolicy,
} from "./registry/artifact-types.js";

// ---------- Default actions + payload schemas -----------------------------

export {
  DEFAULT_ACTIONS,
  META_ACTION_NAMES,
  TOMBSTONE_ACTION_NAMES,
  V1_ACTION_RENAMES,
  ApprovedPayloadSchema,
  ManuallyEditedPayloadSchema,
  RejectedPayloadSchema,
  RegeneratedPayloadSchema,
  NotSelectedFromListPayloadSchema,
  MuteTriggeredPayloadSchema,
  SilentlyAcceptedPayloadSchema,
  SilentlyRejectedExpiredPayloadSchema,
  InternallyUnobservedExternallyCompletedPayloadSchema,
  ManuallyReplacedPayloadSchema,
  CorrectedPayloadSchema,
  CancelledPayloadSchema,
  SupersededByPayloadSchema,
  type TombstoneActionName,
} from "./registry/default-actions.js";

// ---------- Layer 3 — Reaction Evaluation ---------------------------------

export {
  evaluateReaction,
  DEFAULT_CLASSIFIER_VERSION,
  type ClassifierContext,
} from "./classifier.js";

// ---------- Layer 4 — Actionable Result Inference -------------------------

export {
  evaluateRule,
  evaluateRules,
  type ActionabilityDecision,
  type InferenceContext,
} from "./inference-engine.js";

// ---------- Topic-pattern matcher -----------------------------------------

export { matchesTopic } from "./topic-matcher.js";

// ---------- Schema upcasters ----------------------------------------------

export {
  type EventUpcaster,
  v1ToV2_1Upcaster,
  upcastEvent,
  upcastStream,
  validateUpcasterChain,
} from "./upcaster.js";

// ---------- Edit-diff labeler ---------------------------------------------

export { classifyEditDiff, type ChangeLabel } from "./edit-diff-labeler.js";

// ---------- Projection engine ---------------------------------------------

export { ProjectionEngine, type ProjectionBuilder } from "./projection-engine.js";

// ---------- Ports ---------------------------------------------------------

export type { EventStorePort, Transaction } from "./ports/event-store-port.js";
export type { ProjectionStorePort } from "./ports/projection-store-port.js";

// Consumer-facing facade
export type {
  CapturePort,
  // Deprecated v1 alias retained for back-compat
  FeedbackPort,
  RebuildResult,
  Unsubscribe,
} from "./ports/capture-port.js";

// Bus & topics
export type {
  EventBusPort,
  SubscribeOptions,
  SubscribeCapabilities,
} from "./ports/event-bus-port.js";
export {
  topicsFor,
  topicsForActionabilityDecision,
  assertSupportedSubscribeOptions,
} from "./ports/event-bus-port.js";

// Other infrastructure ports
export type { DedupeStorePort } from "./ports/dedupe-store-port.js";
export type { MetricsPort } from "./ports/metrics-port.js";
export { noopMetrics } from "./ports/metrics-port.js";

export type {
  ActionabilityRule,
  ActionabilityRulesPort,
  RulePredicate,
  // Deprecated v1 aliases
  InferenceRule,
  InferenceRulesPort,
} from "./ports/actionability-rules-port.js";

export type { OutboxPort, OutboxRow } from "./ports/outbox-port.js";

export type {
  TrackedArtifactsPort,
  TrackedArtifactRow,
  TrackedArtifactStatus,
  ClaimDueWaitingInput,
} from "./ports/tracked-artifacts-port.js";

export type { ActionabilityDecisionsStore } from "./ports/actionability-decisions-store-port.js";

// ---------- Lifecycle Worker (Layer 2) -----------------------------------

export {
  createLifecycleWorker,
  type LifecycleWorker,
  type LifecycleWorkerOptions,
} from "./lifecycle-worker.js";

// ---------- Middleware ----------------------------------------------------

export {
  type Middleware,
  compose,
  loggingMiddleware,
  type LoggingOptions,
  validationMiddleware,
  injectProvenanceMiddleware,
  metricsMiddleware,
  retryMiddleware,
  type RetryOptions,
  idempotencyMiddleware,
  type IdempotencyOptions,
  correlationIdMiddleware,
} from "./middleware/index.js";

// ---------- Factory -------------------------------------------------------

export { createFeedback, type CreateFeedbackOptions } from "./create-feedback.js";
