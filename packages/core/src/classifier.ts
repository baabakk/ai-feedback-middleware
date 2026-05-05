import type { Polarity, Inference } from "./event-types.js";
import type { FeedbackActionDefinition } from "./registry/actions.js";
import type { InferenceRule } from "./ports/inference-rules-port.js";
import { evaluateRules, type InferenceContext } from "./inference-engine.js";

/**
 * Context passed to the classifier.
 *
 * - `rules`: the active inference rules (loaded by createFeedback at capture time)
 * - `history`: recent events for the partition (for threshold evaluation)
 * - `now`: optional override for testing
 */
export interface ClassifierContext {
  task_type: string;
  producer: string;
  artifact_type: string;
  rules?: InferenceRule[];
  history?: ReadonlyArray<{ action: string; timestamp: string }>;
  now?: string;
}

/**
 * Pure deterministic classifier. Same inputs produce same outputs, always.
 * No LLM, no I/O, no randomness.
 *
 * Polarity is the action's default. Inference is the action's default unless
 * a registered rule matches the predicate AND the threshold is met within
 * the configured window, in which case the rule's `result_if_met` wins.
 */
export function classify(
  action: FeedbackActionDefinition,
  _payload: unknown,
  context?: ClassifierContext,
): {
  polarity: Polarity;
  inference: Inference;
} {
  const polarity = action.polarity;
  let inference: Inference = action.defaultInference;

  if (context && context.rules && context.rules.length > 0) {
    const inferenceContext: InferenceContext = {
      action: action.name,
      task_type: context.task_type,
      producer: context.producer,
      artifact_type: context.artifact_type,
      recentActions: context.history ?? [],
      ...(context.now !== undefined && { now: context.now }),
    };
    inference = evaluateRules(context.rules, inferenceContext, action.defaultInference);
  }

  return { polarity, inference };
}
