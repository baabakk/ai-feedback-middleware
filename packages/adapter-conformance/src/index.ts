export {
  runEventStoreConformance,
  type EventStoreConformanceOptions,
} from "./event-store-conformance.js";
export {
  runProjectionStoreConformance,
  type ProjectionStoreConformanceOptions,
} from "./projection-store-conformance.js";
export {
  runEventBusConformance,
  type EventBusConformanceOptions,
} from "./event-bus-conformance.js";
export {
  runDedupeStoreConformance,
  type DedupeStoreConformanceOptions,
} from "./dedupe-store-conformance.js";
export { runOutboxConformance, type OutboxConformanceOptions } from "./outbox-conformance.js";

export {
  runActionabilityRulesConformance,
  type ActionabilityRulesConformanceOptions,
  // deprecated v1 aliases
  runInferenceRulesConformance,
  type InferenceRulesConformanceOptions,
} from "./actionability-rules-conformance.js";

export {
  runTrackedArtifactsConformance,
  type TrackedArtifactsConformanceOptions,
} from "./tracked-artifacts-conformance.js";

export {
  runActionabilityDecisionsConformance,
  type ActionabilityDecisionsConformanceOptions,
} from "./actionability-decisions-conformance.js";

export { makeReaction, makeCapture, makeEvent, collect } from "./test-fixtures.js";
export { waitUntil } from "./poll.js";
