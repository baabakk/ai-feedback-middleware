/**
 * @deprecated Use `actionability-rules.ts`. This file re-exports the new
 * factory under the old name for v0.2.x → v0.3.x consumer-import resolution.
 */
export {
  createInMemoryActionabilityRulesStore as createInMemoryInferenceRulesStore,
  type InMemoryActionabilityRulesOptions as InMemoryInferenceRulesOptions,
} from "./actionability-rules.js";
