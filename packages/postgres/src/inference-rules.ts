/**
 * @deprecated Use `actionability-rules.ts`. This module re-exports the new
 * factory under the old name for v0.2.x → v0.3.x consumer-import resolution.
 */
export {
  createPostgresActionabilityRulesStore as createPostgresInferenceRulesStore,
  type PostgresActionabilityRulesOptions as PostgresInferenceRulesOptions,
} from "./actionability-rules.js";
