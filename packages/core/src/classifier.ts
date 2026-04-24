import type { Polarity, Inference } from "./event-types.js";
import type { FeedbackActionDefinition } from "./registry/actions.js";

/**
 * Context passed to the classifier for inference rule evaluation.
 *
 * In F0, classifier ignores history and always returns the action's defaults.
 * F2 adds the inference rules engine that uses recentActions.
 */
export interface ClassifierContext {
  /** Recent events for the same partition (for threshold-based inference rules in F2+). */
  recentActions?: ReadonlyArray<{ action: string; timestamp: string }>;
  /** Optional: now timestamp (defaults to new Date().toISOString()). */
  now?: string;
}

/**
 * Pure deterministic classifier.
 *
 * Same inputs produce same outputs, always. No LLM, no I/O, no randomness.
 * In F0 this returns the action's default polarity and default inference.
 * F2 will extend with threshold-based inference rules.
 */
export function classify(
  action: FeedbackActionDefinition,
  _payload: unknown,
  _context: ClassifierContext = {},
): {
  polarity: Polarity;
  inference: Inference;
} {
  return {
    polarity: action.polarity,
    inference: action.defaultInference,
  };
}
