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

// Default actions + their payload schemas
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

// Projection engine
export { ProjectionEngine, type ProjectionBuilder } from "./projection-engine.js";

// Ports
export type { EventStorePort, Transaction } from "./ports/event-store-port.js";
export type { ProjectionStorePort } from "./ports/projection-store-port.js";
export type { FeedbackPort, RebuildResult, Unsubscribe } from "./ports/feedback-port.js";

// Factory
export { createFeedback, type CreateFeedbackOptions } from "./create-feedback.js";
