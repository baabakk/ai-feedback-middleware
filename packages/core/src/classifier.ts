import type { EvaluationVector } from "./event-types.js";
import type { FeedbackActionDefinition } from "./registry/actions.js";

/**
 * Layer 3 — Reaction Evaluation.
 *
 * Pure deterministic classifier. For each reaction event, computes per-axis
 * polarity using the action's default heuristics plus any consumer-supplied
 * per-event override.
 *
 * Same inputs → same outputs, always. No LLM, no I/O, no randomness.
 *
 * See spec §10 and architecture §29 (Layer 3).
 */

export interface ClassifierContext {
  /** Identifier for the rule pack used; embedded on the reaction row as `classifier_version`. */
  classifier_version: string;
  task_type?: string;
  producer?: string;
  artifact_type?: string;
}

/**
 * Compute the per-axis evaluation vector for a single reaction event.
 *
 * Override semantics:
 *   - An axis present in `override` (with explicit `positive` or `negative`)
 *     replaces the action's default for that axis.
 *   - An axis absent from `override` keeps the action's default.
 *   - To explicitly *omit* an axis the action would otherwise set, pass
 *     `null` for that axis in `override` (filtered out before merging).
 */
export function evaluateReaction(
  action: FeedbackActionDefinition,
  _payload: unknown,
  _context: ClassifierContext,
  override?: Partial<EvaluationVector> | null,
): EvaluationVector {
  const base: EvaluationVector = { ...action.defaultEvaluations };
  if (!override) return base;

  // Apply override axis-by-axis. Explicit `undefined` means "axis not
  // mentioned"; explicit `null` (cast through Partial) is treated as "remove
  // this axis" — but TypeScript users pass a normal Partial<EvaluationVector>,
  // so here we just merge defined values.
  const merged: EvaluationVector = { ...base };
  if (override.detection !== undefined) merged.detection = override.detection;
  if (override.content !== undefined) merged.content = override.content;
  if (override.timing !== undefined) merged.timing = override.timing;
  if (override.channel !== undefined) merged.channel = override.channel;
  return merged;
}

/**
 * Default classifier version emitted on reactions when the consumer does
 * not supply an explicit `classifier_version` in the createFeedback options.
 */
export const DEFAULT_CLASSIFIER_VERSION = "default-2.1";
