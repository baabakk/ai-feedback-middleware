import type {
  CapturedEvaluatedReactionEvent,
  ProjectionBuilder,
} from "@ai-feedback-middleware/core";

export interface ApprovedExample {
  event_id: string;
  producer: string;
  task_type: string;
  artifact_id: string;
  artifact_version: number;
  /** A hash or reference identifying the canonical-good output. */
  artifact_hash?: string;
  approved_at: string;
}

export interface ApprovedExamplesState {
  examples: ApprovedExample[];
  /** Optional cap; older examples are evicted when exceeded. */
  cap?: number;
}

export interface ApprovedExamplesOptions {
  /** Maximum examples per (producer, task_type). Default 50. */
  capPerKey?: number;
}

/**
 * Reference projection: collects `approved` reactions into a small library
 * keyed by (producer, task_type). A consumer might use this list as
 * few-shot examples for the next generation, training data for
 * fine-tuning, or templates for canonical outputs.
 *
 * Renamed from v1 `WhitelistExamplesProjection` — the v1 name conflated the
 * Layer 4 inference value (whitelist/blacklist/observe) with the per-event
 * action. In 2.1, the projection keys off the `approved` action directly;
 * downstream consumers wanting "decisions that crystallized as
 * actionable_positive" build a separate projection from
 * `actionability_decisions`.
 */
export function createApprovedExamplesProjection(
  options: ApprovedExamplesOptions = {},
): ProjectionBuilder<ApprovedExamplesState> {
  const cap = options.capPerKey ?? 50;
  return {
    name: "approved_examples",
    mode: "sync",
    applies: (event) => event.event_kind === "reaction" && event.action === "approved",
    keyFor: (event) => `${event.producer}::${event.task_type}`,
    apply: (event, current) => {
      const reaction = event as CapturedEvaluatedReactionEvent;
      const prev = current?.examples ?? [];
      const next: ApprovedExample = {
        event_id: reaction.event_id,
        producer: reaction.producer,
        task_type: reaction.task_type,
        artifact_id: reaction.artifact_id,
        artifact_version: reaction.artifact_version,
        approved_at: reaction.captured_at,
      };
      const hash = (reaction.payload as { artifact_hash?: string })?.artifact_hash;
      if (hash !== undefined) next.artifact_hash = hash;

      const examples = [...prev, next].slice(-cap);
      return { examples, cap };
    },
  };
}

/** @deprecated v1 alias. Use {@link createApprovedExamplesProjection}. */
export const createWhitelistExamplesProjection = createApprovedExamplesProjection;

/** @deprecated v1 alias. Use {@link ApprovedExample}. */
export type WhitelistExample = ApprovedExample;

/** @deprecated v1 alias. Use {@link ApprovedExamplesState}. */
export type WhitelistExamplesState = ApprovedExamplesState;

/** @deprecated v1 alias. Use {@link ApprovedExamplesOptions}. */
export type WhitelistExamplesOptions = ApprovedExamplesOptions;
