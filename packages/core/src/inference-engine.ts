import type {
  AxisInference,
  AxisPolarity,
  Axis,
  CapturedEvaluatedReactionEvent,
} from "./event-types.js";
import type { ActionabilityRule, RulePredicate } from "./ports/actionability-rules-port.js";
import { TOMBSTONE_ACTION_NAMES } from "./registry/default-actions.js";

/**
 * Layer 4 — Actionable Result Inference.
 *
 * Pure deterministic engine. Reads recent evaluated reactions, applies
 * threshold rules from `actionability_rules`, filters tombstoned artifacts,
 * and emits per-axis decisions.
 *
 * Tombstone filtering is direction-symmetric: an artifact whose events were
 * trending toward `actionable_positive` is excluded just as completely as
 * one trending toward `actionable_negative` once a tombstone arrives.
 *
 * See spec §12 and architecture §29 (Layer 4).
 */

export interface ActionabilityDecision {
  decision_id: string;
  rule_id: string;
  rule_version: string;
  rule_run_at: string;
  artifact_id: string;
  axis: Axis;
  inference: AxisInference;
  evidence_event_ids: string[];
}

export interface InferenceContext {
  /** ISO timestamp; defaults to `new Date().toISOString()` if omitted. */
  now?: string;
  /** Stable id factory; defaults to `crypto.randomUUID`. */
  generateDecisionId?: () => string;
}

/**
 * Compute per-axis actionability decisions for a single rule against a set
 * of candidate reactions. Returns one decision per artifact that matched
 * the rule's threshold.
 *
 * The caller is responsible for selecting candidate reactions (via the
 * EventStore / TrackedArtifacts query layer) and for collecting the set of
 * tombstoned artifact_ids to exclude.
 */
export function evaluateRule(
  rule: ActionabilityRule,
  candidateReactions: ReadonlyArray<CapturedEvaluatedReactionEvent>,
  tombstonedArtifactIds: ReadonlySet<string>,
  context: InferenceContext = {},
): ActionabilityDecision[] {
  if (!rule.active) return [];

  const now = context.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const cutoffMs = nowMs - rule.window_ms;
  const generateId = context.generateDecisionId ?? defaultDecisionId;

  // Filter to rule predicate + window + non-tombstoned + non-meta + axis-matching polarity.
  const inWindow = candidateReactions.filter((r) => {
    if (TOMBSTONE_ACTION_NAMES.includes(r.action as never)) return false;
    if (tombstonedArtifactIds.has(r.artifact_id)) return false;
    const t = Date.parse(r.occurred_at);
    if (Number.isNaN(t) || t < cutoffMs) return false;
    if (!matchesPredicate(rule.applies_when, r)) return false;
    // The reaction's polarity on this axis must match the rule's intended
    // direction. A rule with result_if_met=actionable_negative counts only
    // reactions whose `evaluations[axis] === 'negative'`.
    const axisPolarity = r.evaluations[rule.axis];
    if (!matchesIntendedDirection(axisPolarity, rule.result_if_met)) return false;
    return true;
  });

  // Group by artifact_id; emit one decision per artifact whose count crosses threshold.
  const groups = new Map<string, CapturedEvaluatedReactionEvent[]>();
  for (const r of inWindow) {
    const list = groups.get(r.artifact_id) ?? [];
    list.push(r);
    groups.set(r.artifact_id, list);
  }

  const decisions: ActionabilityDecision[] = [];
  for (const [artifact_id, group] of groups) {
    if (group.length >= rule.threshold) {
      decisions.push({
        decision_id: generateId(),
        rule_id: rule.rule_id,
        rule_version: rule.rule_version,
        rule_run_at: now,
        artifact_id,
        axis: rule.axis,
        inference: rule.result_if_met,
        evidence_event_ids: group.map((r) => r.event_id),
      });
    }
  }
  return decisions;
}

/**
 * Convenience: evaluate every rule in a list against the same candidate set.
 * Returns the flattened set of decisions.
 */
export function evaluateRules(
  rules: ReadonlyArray<ActionabilityRule>,
  candidateReactions: ReadonlyArray<CapturedEvaluatedReactionEvent>,
  tombstonedArtifactIds: ReadonlySet<string>,
  context: InferenceContext = {},
): ActionabilityDecision[] {
  const out: ActionabilityDecision[] = [];
  for (const rule of rules) {
    out.push(...evaluateRule(rule, candidateReactions, tombstonedArtifactIds, context));
  }
  return out;
}

function matchesPredicate(
  predicate: RulePredicate,
  reaction: CapturedEvaluatedReactionEvent,
): boolean {
  if (predicate.action !== undefined && predicate.action !== reaction.action) return false;
  if (predicate.task_type !== undefined && predicate.task_type !== reaction.task_type) {
    return false;
  }
  if (
    predicate.task_type_prefix !== undefined &&
    !reaction.task_type.startsWith(predicate.task_type_prefix)
  ) {
    return false;
  }
  if (predicate.producer !== undefined && predicate.producer !== reaction.producer) return false;
  if (
    predicate.artifact_type !== undefined &&
    predicate.artifact_type !== reaction.artifact_type
  ) {
    return false;
  }
  return true;
}

function matchesIntendedDirection(
  axisPolarity: AxisPolarity | undefined,
  resultIfMet: Exclude<AxisInference, "continue_to_observe">,
): boolean {
  if (axisPolarity === undefined) return false;
  if (resultIfMet === "actionable_positive") return axisPolarity === "positive";
  if (resultIfMet === "actionable_negative") return axisPolarity === "negative";
  return false;
}

function defaultDecisionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
