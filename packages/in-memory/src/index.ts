export { createInMemoryEventStore, type InMemoryEventStoreOptions } from "./event-store.js";
export { createInMemoryProjectionStore } from "./projection-store.js";
export { createInMemoryEventBus } from "./event-bus.js";
export { createInMemoryDedupeStore } from "./dedupe-store.js";
export {
  createInMemoryInferenceRulesStore,
  type InMemoryInferenceRulesOptions,
} from "./inference-rules.js";
export { createInMemoryOutbox } from "./outbox.js";
