import type {
  CapturedEvaluatedReactionEvent,
  ProjectionBuilder,
} from "@ai-feedback-middleware/core";

export interface RemovedPhrase {
  phrase: string;
  /** Number of times this phrase has been observed in original-but-removed-by-edit. */
  count: number;
  /** Last manually_edited event_id that surfaced this phrase. */
  last_event_id: string;
  last_seen_at: string;
}

export interface RemovedPhrasesState {
  /** Phrase string -> stats. */
  phrases: Record<string, RemovedPhrase>;
}

export interface RemovedPhrasesOptions {
  /**
   * The set of phrases the projection watches for. When a `manually_edited`
   * reaction removes a phrase from this set (present in `original`, absent
   * in `corrected`), the projection increments the count.
   *
   * Defaults to a small set of corporate-pleasantry filler typical of LLM
   * outputs.
   */
  watchPhrases?: string[];
}

/** @deprecated v1 alias for {@link RemovedPhrase}. */
export type BlacklistPhrase = RemovedPhrase;
/** @deprecated v1 alias for {@link RemovedPhrasesState}. */
export type BlacklistPhrasesState = RemovedPhrasesState;
/** @deprecated v1 alias for {@link RemovedPhrasesOptions}. */
export type BlacklistPhrasesOptions = RemovedPhrasesOptions;

const DEFAULT_WATCH_PHRASES = [
  "i hope this email finds you well",
  "i wanted to reach out",
  "i hope this finds you well",
  "leveraging synergies",
  "circle back",
  "moving the needle",
  "please find attached",
  "kind regards",
  "to whom it may concern",
  "i'd love to connect",
];

/**
 * Reference projection: observes `manually_edited` reactions that REMOVE a
 * watched phrase from the original. When the user consistently strikes a
 * phrase out, it's a strong negative-content signal on the content axis —
 * the consumer can inject an "anti-pattern list" into subsequent generations.
 */
export function createRemovedPhrasesProjection(
  options: RemovedPhrasesOptions = {},
): ProjectionBuilder<RemovedPhrasesState> {
  const watch = (options.watchPhrases ?? DEFAULT_WATCH_PHRASES).map((p) => p.toLowerCase());

  return {
    name: "removed_phrases",
    mode: "sync",
    applies: (event) =>
      event.event_kind === "reaction" && event.action === "manually_edited",
    // One global key — phrases are not partition-scoped (the same corporate
    // filler is junk regardless of which artifact triggered the edit).
    keyFor: () => "global",
    apply: (event, current) => {
      const reaction = event as CapturedEvaluatedReactionEvent;
      const payload = reaction.payload as { original?: string; corrected?: string };
      const original = (payload.original ?? "").toLowerCase();
      const corrected = (payload.corrected ?? "").toLowerCase();
      const prev = current?.phrases ?? {};
      const next = { ...prev };

      for (const phrase of watch) {
        const inOriginal = original.includes(phrase);
        const inCorrected = corrected.includes(phrase);
        if (inOriginal && !inCorrected) {
          const existing = next[phrase];
          next[phrase] = {
            phrase,
            count: (existing?.count ?? 0) + 1,
            last_event_id: reaction.event_id,
            last_seen_at: reaction.captured_at,
          };
        }
      }

      return { phrases: next };
    },
  };
}

/** @deprecated v1 alias. Use {@link createRemovedPhrasesProjection}. */
export const createBlacklistPhrasesProjection = createRemovedPhrasesProjection;
