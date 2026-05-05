import type { Inference } from "../event-types.js";

/**
 * Predicate matched against an event + its history.
 *
 * Adapters may serialize this however they like (JSONB column, separate
 * rows, etc.) but the core engine evaluates it as data.
 */
export interface RulePredicate {
  /** Match a specific action (e.g., "expired", "regenerate"). */
  action?: string;
  /** Match task_type by exact string. */
  task_type?: string;
  /** Match task_type by prefix (e.g., "draft:" matches "draft:email:warm"). */
  task_type_prefix?: string;
  /** Match a specific producer/role/agent. */
  producer?: string;
  /** Match a specific artifact type. */
  artifact_type?: string;
}

export interface InferenceRule {
  rule_id: string;
  applies_when: RulePredicate;
  /** Number of matching events within `window_ms` required to trigger result_if_met. */
  threshold: number;
  /** Time window in milliseconds. */
  window_ms: number;
  /** Inference result when threshold met. */
  result_if_met: Exclude<Inference, "observe">;
  /** Inference result when threshold not yet met. Defaults to "observe". */
  result_if_unmet?: Inference;
  active: boolean;
  notes?: string;
}

/** Storage for inference rules. List + CRUD. */
export interface InferenceRulesPort {
  /** All active rules. The classifier evaluates them in registration order. */
  list(): Promise<InferenceRule[]>;

  /** Insert or update a rule (by rule_id). */
  upsert(rule: InferenceRule): Promise<void>;

  /** Remove a rule by id. Idempotent. */
  remove(ruleId: string): Promise<void>;
}
