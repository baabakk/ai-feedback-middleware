export { createInMemoryEventStore, type InMemoryEventStoreOptions } from "./event-store.js";
export { createInMemoryProjectionStore } from "./projection-store.js";
export { createInMemoryEventBus } from "./event-bus.js";
export { createInMemoryDedupeStore } from "./dedupe-store.js";
export { createInMemoryOutbox } from "./outbox.js";

export {
  createInMemoryActionabilityRulesStore,
  // deprecated v1 alias re-export
  createInMemoryInferenceRulesStore,
  type InMemoryActionabilityRulesOptions,
  type InMemoryInferenceRulesOptions,
} from "./actionability-rules.js";

export {
  createInMemoryTrackedArtifactsStore,
  type InMemoryTrackedArtifactsOptions,
} from "./tracked-artifacts.js";

export {
  createInMemoryActionabilityDecisionsStore,
  type InMemoryActionabilityDecisionsOptions,
} from "./actionability-decisions.js";
