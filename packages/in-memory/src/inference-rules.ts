import type { InferenceRulesPort, InferenceRule } from "@llm-feedback-middleware/core";

export interface InMemoryInferenceRulesOptions {
  /** Optional initial rules. */
  seed?: InferenceRule[];
}

export function createInMemoryInferenceRulesStore(
  options: InMemoryInferenceRulesOptions = {},
): InferenceRulesPort {
  const rules = new Map<string, InferenceRule>();
  for (const r of options.seed ?? []) rules.set(r.rule_id, r);

  return {
    async list(): Promise<InferenceRule[]> {
      return Array.from(rules.values()).filter((r) => r.active);
    },

    async upsert(rule: InferenceRule): Promise<void> {
      rules.set(rule.rule_id, rule);
    },

    async remove(ruleId: string): Promise<void> {
      rules.delete(ruleId);
    },
  };
}
