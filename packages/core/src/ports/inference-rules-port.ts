/**
 * @deprecated Use `actionability-rules-port.ts` instead.
 *
 * The v1 `InferenceRulesPort` collapsed all four axes into one rule output.
 * 2.1 splits this into per-axis rules. This file re-exports the new types
 * under their old names to keep upcaster code compiling during the v1 → v2.1
 * transition. New code must import from `actionability-rules-port.ts`.
 */
export type {
  ActionabilityRule as InferenceRule,
  ActionabilityRulesPort as InferenceRulesPort,
  RulePredicate,
} from "./actionability-rules-port.js";
