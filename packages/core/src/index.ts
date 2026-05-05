// Event types
export {
  FeedbackEventSchema,
  ProvenanceSchema,
  type FeedbackEvent,
  type CaptureInput,
  type EventFilter,
  type Provenance,
  type Source,
  type Polarity,
  type Inference,
} from "./event-types.js";

// Action registry
export { ActionRegistry, type FeedbackActionDefinition } from "./registry/actions.js";

// Artifact type registry
export {
  ArtifactTypeRegistry,
  type ArtifactTypeDefinition,
  type RetentionPolicy,
} from "./registry/artifact-types.js";

// Default actions + payload schemas
export {
  DEFAULT_ACTIONS,
  ApprovePayloadSchema,
  EditPayloadSchema,
  RejectPayloadSchema,
  RegeneratePayloadSchema,
  ExpiredPayloadSchema,
  SilentAcceptPayloadSchema,
} from "./registry/default-actions.js";

// Classifier
export { classify, type ClassifierContext } from "./classifier.js";

// Inference engine
export { evaluateRules, type InferenceContext } from "./inference-engine.js";

// Topic-pattern matcher (for adapters that need to filter on receive)
export { matchesTopic } from "./topic-matcher.js";

// Schema upcasters
export {
  type EventUpcaster,
  upcastEvent,
  upcastStream,
  validateUpcasterChain,
} from "./upcaster.js";

// Edit-diff labeler (deterministic, no LLM)
export { classifyEditDiff, type ChangeLabel } from "./edit-diff-labeler.js";

// Projection engine
export { ProjectionEngine, type ProjectionBuilder } from "./projection-engine.js";

// Ports
export type { EventStorePort, Transaction } from "./ports/event-store-port.js";
export type { ProjectionStorePort } from "./ports/projection-store-port.js";
export type { FeedbackPort, RebuildResult, Unsubscribe } from "./ports/feedback-port.js";
export type {
  EventBusPort,
  SubscribeOptions,
  SubscribeCapabilities,
} from "./ports/event-bus-port.js";
export { topicsFor, assertSupportedSubscribeOptions } from "./ports/event-bus-port.js";
export type { DedupeStorePort } from "./ports/dedupe-store-port.js";
export type { MetricsPort } from "./ports/metrics-port.js";
export { noopMetrics } from "./ports/metrics-port.js";
export type {
  InferenceRulesPort,
  InferenceRule,
  RulePredicate,
} from "./ports/inference-rules-port.js";
export type { OutboxPort, OutboxRow } from "./ports/outbox-port.js";

// Middleware
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

// Factory
export { createFeedback, type CreateFeedbackOptions } from "./create-feedback.js";
