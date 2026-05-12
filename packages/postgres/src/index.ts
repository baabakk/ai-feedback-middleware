export { createPostgresEventStore, type PostgresEventStoreOptions } from "./event-store.js";
export {
  createPostgresProjectionStore,
  type PostgresProjectionStoreOptions,
} from "./projection-store.js";
export { createPostgresOutbox, type PostgresOutboxOptions } from "./outbox.js";

export {
  createPostgresActionabilityRulesStore,
  type PostgresActionabilityRulesOptions,
  // deprecated v1 alias
} from "./actionability-rules.js";
export {
  createPostgresInferenceRulesStore,
  type PostgresInferenceRulesOptions,
} from "./inference-rules.js";

export {
  createPostgresTrackedArtifactsStore,
  type PostgresTrackedArtifactsOptions,
} from "./tracked-artifacts.js";

export {
  createPostgresActionabilityDecisionsStore,
  type PostgresActionabilityDecisionsOptions,
} from "./actionability-decisions.js";

export { startOutboxScanner, type OutboxScannerOptions } from "./outbox-scanner.js";
export { runMigrations } from "./migrate.js";
