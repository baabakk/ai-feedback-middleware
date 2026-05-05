import type { Inference } from "./event-types.js";
import type { InferenceRule, RulePredicate } from "./ports/inference-rules-port.js";

/**
 * Context passed to the inference engine at classification time.
 *
 * `recentActions` is the history for the same partition (or producer/task)
 * within a sliding window. Adapters typically scope this query in createFeedback.
 */
export interface InferenceContext {
  action: string;
  task_type: string;
  producer: string;
  artifact_type: string;
  /** Recent events on the same partition. Used to count threshold matches. */
  recentActions: ReadonlyArray<{ action: string; timestamp: string }>;
  /** Now timestamp. Defaults to `new Date().toISOString()`. */
  now?: string;
}

/**
 * Pure function: given the rules + context, return the inference outcome.
 *
 * Evaluation is first-match-wins in registration order. A rule matches if:
 *   1. Its predicate matches the current event's metadata.
 *   2. The number of `recentActions` matching the predicate within `window_ms`
 *      meets or exceeds `threshold`.
 *
 * If no rule matches, callers fall back to the action's `defaultInference`.
 */
export function evaluateRules(
  rules: InferenceRule[],
  context: InferenceContext,
  defaultInference: Inference,
): Inference {
  const nowMs = Date.parse(context.now ?? new Date().toISOString());

  for (const rule of rules) {
    if (!rule.active) continue;
    if (!matchesPredicate(rule.applies_when, context)) continue;

    const cutoffMs = nowMs - rule.window_ms;
    let count = 0;
    for (const recent of context.recentActions) {
      const t = Date.parse(recent.timestamp);
      if (Number.isNaN(t)) continue;
      if (t < cutoffMs) continue;
      // The recent event must also match the predicate (e.g., same action).
      if (!matchesPredicate(rule.applies_when, { ...context, action: recent.action })) continue;
      count++;
      if (count >= rule.threshold) {
        return rule.result_if_met;
      }
    }
    // Predicate matched but threshold did not; honor result_if_unmet (default observe).
    return rule.result_if_unmet ?? "observe";
  }
  return defaultInference;
}

function matchesPredicate(predicate: RulePredicate, context: InferenceContext): boolean {
  if (predicate.action !== undefined && predicate.action !== context.action) return false;
  if (predicate.task_type !== undefined && predicate.task_type !== context.task_type) return false;
  if (
    predicate.task_type_prefix !== undefined &&
    !context.task_type.startsWith(predicate.task_type_prefix)
  ) {
    return false;
  }
  if (predicate.producer !== undefined && predicate.producer !== context.producer) return false;
  if (predicate.artifact_type !== undefined && predicate.artifact_type !== context.artifact_type) {
    return false;
  }
  return true;
}
