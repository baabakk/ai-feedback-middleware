import type { FeedbackEvent, ProjectionBuilder } from "@llm-feedback-middleware/core";

export interface WhitelistExample {
  event_id: string;
  producer: string;
  task_type: string;
  artifact_id: string;
  artifact_version: number;
  /** A hash or reference identifying the canonical-good output. */
  artifact_hash?: string;
  approved_at: string;
}

export interface WhitelistExamplesState {
  examples: WhitelistExample[];
  /** Optional cap; older examples are evicted when exceeded. */
  cap?: number;
}

export interface WhitelistExamplesOptions {
  /** Maximum examples per (producer, task_type). Default 50. */
  capPerKey?: number;
}

/**
 * Reference projection: collects events with `inference: whitelist` (typically
 * approves) into a small library keyed by (producer, task_type). A consumer
 * might use this list as few-shot examples for the next generation, training
 * data for fine-tuning, or templates for canonical outputs.
 */
export function createWhitelistExamplesProjection(
  options: WhitelistExamplesOptions = {},
): ProjectionBuilder<WhitelistExamplesState> {
  const cap = options.capPerKey ?? 50;
  return {
    name: "whitelist_examples",
    mode: "sync",
    applies: (event) => event.inference === "whitelist",
    keyFor: (event) => `${event.producer}::${event.task_type}`,
    apply: (event: FeedbackEvent, current) => {
      const prev = current?.examples ?? [];
      const next: WhitelistExample = {
        event_id: event.event_id,
        producer: event.producer,
        task_type: event.task_type,
        artifact_id: event.artifact_id,
        artifact_version: event.artifact_version,
        approved_at: event.captured_at,
      };
      const hash = (event.payload as { artifact_hash?: string })?.artifact_hash;
      if (hash !== undefined) next.artifact_hash = hash;

      const examples = [...prev, next].slice(-cap); // keep most recent cap entries
      return { examples, cap };
    },
  };
}
