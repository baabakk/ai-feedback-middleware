import type {
  ActionabilityDecision,
  ActionabilityDecisionsStore,
  ActionabilityFilter,
} from "@ai-feedback-middleware/core";

export interface InMemoryActionabilityDecisionsOptions {
  seed?: ActionabilityDecision[];
}

export function createInMemoryActionabilityDecisionsStore(
  options: InMemoryActionabilityDecisionsOptions = {},
): ActionabilityDecisionsStore {
  const decisions: ActionabilityDecision[] = [...(options.seed ?? [])];

  function matches(d: ActionabilityDecision, filter?: ActionabilityFilter): boolean {
    if (!filter) return true;
    if (filter.axis !== undefined && d.axis !== filter.axis) return false;
    if (filter.inference !== undefined && d.inference !== filter.inference) return false;
    if (filter.rule_id !== undefined && d.rule_id !== filter.rule_id) return false;
    if (filter.from_timestamp !== undefined && d.rule_run_at < filter.from_timestamp) return false;
    if (filter.to_timestamp !== undefined && d.rule_run_at > filter.to_timestamp) return false;
    // The artifact_type / producer / task_type filters require joining
    // against the artifact metadata, which the in-memory store does not
    // duplicate onto decisions. Adapters with richer storage may push these
    // into SQL.
    return true;
  }

  return {
    async appendBatch(batch: ActionabilityDecision[]): Promise<void> {
      decisions.push(...batch);
    },

    async *read(filter?: ActionabilityFilter): AsyncIterable<ActionabilityDecision> {
      for (const d of decisions) {
        if (matches(d, filter)) yield d;
      }
    },
  };
}
