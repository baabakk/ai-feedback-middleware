import type { FeedbackEvent, ProjectionBuilder } from "@llm-feedback-middleware/core";

export interface BlacklistPhrase {
  phrase: string;
  /** Number of times this phrase has been observed in original-but-removed-by-edit. */
  count: number;
  /** Last edit event_id that surfaced this phrase. */
  last_event_id: string;
  last_seen_at: string;
}

export interface BlacklistPhrasesState {
  /** Phrase string -> stats. */
  phrases: Record<string, BlacklistPhrase>;
}

export interface BlacklistPhrasesOptions {
  /**
   * The set of phrases the projection watches for. When an edit removes a
   * phrase from this set (present in `original`, absent in `corrected`),
   * the projection increments the count.
   *
   * Defaults to a small set of corporate-pleasantry filler typical of LLM
   * outputs.
   */
  watchPhrases?: string[];
}

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
 * Reference projection: observes edits that REMOVE a watched phrase from the
 * original. When the user consistently strikes a phrase out, it's a strong
 * blacklist signal — the consumer can inject an "anti-pattern list" into
 * subsequent generations.
 */
export function createBlacklistPhrasesProjection(
  options: BlacklistPhrasesOptions = {},
): ProjectionBuilder<BlacklistPhrasesState> {
  const watch = (options.watchPhrases ?? DEFAULT_WATCH_PHRASES).map((p) => p.toLowerCase());

  return {
    name: "blacklist_phrases",
    mode: "sync",
    applies: (event) => event.action === "edit" && event.inference === "blacklist",
    // One global key — phrases are not partition-scoped (the same corporate
    // filler is junk regardless of which artifact triggered the edit).
    keyFor: () => "global",
    apply: (event: FeedbackEvent, current) => {
      const payload = event.payload as { original?: string; corrected?: string };
      const original = (payload.original ?? "").toLowerCase();
      const corrected = (payload.corrected ?? "").toLowerCase();
      const prev = current?.phrases ?? {};
      const next = { ...prev };

      for (const phrase of watch) {
        const inOriginal = original.includes(phrase);
        const inCorrected = corrected.includes(phrase);
        if (inOriginal && !inCorrected) {
          // Edit removed the phrase — increment.
          const existing = next[phrase];
          next[phrase] = {
            phrase,
            count: (existing?.count ?? 0) + 1,
            last_event_id: event.event_id,
            last_seen_at: event.captured_at,
          };
        }
      }

      return { phrases: next };
    },
  };
}
