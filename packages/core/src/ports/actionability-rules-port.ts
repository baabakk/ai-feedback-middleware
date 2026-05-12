import type { Axis, AxisInference } from "../event-types.js";

/**
 * Predicate matched by Layer 4 against a candidate set of evaluated reactions.
 * Adapters serialize this however they like (JSONB, separate rows, etc.); the
 * core engine evaluates it as data.
 */
export interface RulePredicate {
  /** Match a specific action name. */
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

/**
 * A rule defining when crystallized per-axis inference should be emitted.
 *
 * Each rule decides exactly one axis. To express "3 regenerated events on
 * the same partition in 60s ⇒ content actionable_negative", create a rule
 * with `axis: "content"`, `threshold: 3`, `window_ms: 60_000`,
 * `result_if_met: "actionable_negative"`.
 *
 * The inference engine filters tombstoned artifacts (cancelled, corrected,
 * superseded_by) before evaluating thresholds.
 */
export interface ActionabilityRule {
  rule_id: string;
  rule_version: string;
  applies_when: RulePredicate;
  /** Which axis this rule decides. */
  axis: Axis;
  /** Number of matching reactions within `window_ms` required to fire `result_if_met`. */
  threshold: number;
  /** Time window in milliseconds. */
  window_ms: number;
  /** Inference value emitted when the threshold is met. */
  result_if_met: Exclude<AxisInference, "continue_to_observe">;
  /** Inference value emitted when threshold not met. Defaults to `continue_to_observe`. */
  result_if_unmet?: AxisInference;
  active: boolean;
  notes?: string;
}

/** Storage for actionability rules. List + CRUD. */
export interface ActionabilityRulesPort {
  /** All rules. The engine evaluates active ones in registration order. */
  list(): Promise<ActionabilityRule[]>;

  /** Insert or update a rule (by rule_id). */
  upsert(rule: ActionabilityRule): Promise<void>;

  /** Remove a rule by id. Idempotent. */
  remove(ruleId: string): Promise<void>;
}

/**
 * @deprecated v1 alias. Use {@link ActionabilityRulesPort} instead. The v1
 * `InferenceRulesPort` collapsed all four axes into one rule output. Retained
 * only for upcaster code translating v1 → v2.1.
 */
export type InferenceRule = ActionabilityRule;

/** @deprecated v1 alias. Use {@link ActionabilityRulesPort}. */
export type InferenceRulesPort = ActionabilityRulesPort;
