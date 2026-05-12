import type {
  ActionabilityRule,
  ActionabilityRulesPort,
} from "@ai-feedback-middleware/core";

export interface InMemoryActionabilityRulesOptions {
  /** Optional initial rules. */
  seed?: ActionabilityRule[];
}

export function createInMemoryActionabilityRulesStore(
  options: InMemoryActionabilityRulesOptions = {},
): ActionabilityRulesPort {
  const rules = new Map<string, ActionabilityRule>();
  for (const r of options.seed ?? []) rules.set(r.rule_id, r);

  return {
    async list(): Promise<ActionabilityRule[]> {
      return Array.from(rules.values());
    },

    async upsert(rule: ActionabilityRule): Promise<void> {
      rules.set(rule.rule_id, rule);
    },

    async remove(ruleId: string): Promise<void> {
      rules.delete(ruleId);
    },
  };
}

/**
 * @deprecated v1 alias. Use {@link createInMemoryActionabilityRulesStore}.
 * The v1 InferenceRulesPort collapsed all four axes into one rule output.
 */
export const createInMemoryInferenceRulesStore = createInMemoryActionabilityRulesStore;

/** @deprecated v1 alias. Use {@link InMemoryActionabilityRulesOptions}. */
export type InMemoryInferenceRulesOptions = InMemoryActionabilityRulesOptions;
