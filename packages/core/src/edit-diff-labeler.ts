/**
 * Deterministic edit-diff labeler.
 *
 * When a user edits an artifact (e.g., shortens a draft, removes formality,
 * adds a deadline), this module classifies the change with a small atomic
 * label set. The classification is purely heuristic: word counts, phrase
 * matching, structural comparisons. NO LLM, NO randomness, NO I/O.
 *
 * Why deterministic? Because the whole point of feedback classification is
 * to escape the circular dependency where one LLM judges the mistakes of
 * another. Crude heuristics give honest, reproducible labels.
 *
 * 19 labels covering the most common edit dimensions for human writing:
 * length, formality, warmth, tone strength, deadlines, calls to action,
 * factual fixes, structure, greetings, closings.
 */

export type ChangeLabel =
  | "remove_formality"
  | "add_formality"
  | "reduce_length"
  | "increase_length"
  | "soften_tone"
  | "strengthen_tone"
  | "add_warmth"
  | "remove_warmth"
  | "add_relationship_context"
  | "remove_relationship_context"
  | "add_deadline"
  | "remove_deadline"
  | "make_request_explicit"
  | "add_call_to_action"
  | "remove_call_to_action"
  | "fix_factual_error"
  | "change_structure"
  | "change_greeting"
  | "change_closing"
  | "add_warmth_phrase"
  | "remove_warmth_phrase"
  | "other";

const FORMAL_PHRASES = [
  "please find attached",
  "i hope this",
  "kind regards",
  "sincerely",
  "dear ",
  "pursuant to",
  "as per our",
  "to whom it may concern",
  "yours faithfully",
  "respectfully",
];

const WARM_PHRASES = [
  "great to",
  "loved",
  "enjoyed",
  "wonderful",
  "excited",
  "looking forward",
  "appreciate",
  "thanks so much",
  "really glad",
  "delighted",
];

const FIRM_PHRASES = [
  "need to",
  "must",
  "require",
  "expect",
  "deadline",
  "non-negotiable",
  "by end of",
  "no later than",
  "asap",
  "immediately",
];

const CTA_PHRASES = [
  "let me know",
  "please confirm",
  "can you",
  "would you",
  "shall we",
  "next step",
  "let me know if",
  "looking forward to your",
];

const RELATIONSHIP_PHRASES = [
  "as we discussed",
  "following up",
  "per our conversation",
  "as you mentioned",
  "as you know",
  "since we last",
];

const DEADLINE_REGEX =
  /\b(by|before|due|deadline|end of|eod|eow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|next week)\b/i;

interface DiffMetrics {
  lengthDelta: number;
  lengthRatio: number;
  wordDelta: number;
}

function diffMetrics(original: string, edited: string): DiffMetrics {
  const origLen = original.length;
  const editLen = edited.length;
  const origWords = original.split(/\s+/).filter(Boolean).length;
  const editWords = edited.split(/\s+/).filter(Boolean).length;
  return {
    lengthDelta: editLen - origLen,
    lengthRatio: origLen > 0 ? editLen / origLen : edited.length > 0 ? Infinity : 1,
    wordDelta: editWords - origWords,
  };
}

function countPhrases(text: string, phrases: string[]): number {
  const lower = text.toLowerCase();
  return phrases.filter((p) => lower.includes(p)).length;
}

/**
 * Classify the change between two text versions and return atomic labels.
 *
 * Returns at least one label. If no specific heuristic fires, returns ["other"]
 * which is the system's honest admission that the change is uncategorized.
 */
export function classifyEditDiff(original: string, edited: string): ChangeLabel[] {
  const labels: ChangeLabel[] = [];
  const m = diffMetrics(original, edited);

  // Length changes
  if (m.lengthRatio < 0.7) labels.push("reduce_length");
  if (m.lengthRatio > 1.5 && m.lengthRatio !== Infinity) labels.push("increase_length");

  // Formality
  const origFormal = countPhrases(original, FORMAL_PHRASES);
  const editFormal = countPhrases(edited, FORMAL_PHRASES);
  if (origFormal > editFormal) labels.push("remove_formality");
  if (editFormal > origFormal) labels.push("add_formality");

  // Warmth (phrase-level)
  const origWarm = countPhrases(original, WARM_PHRASES);
  const editWarm = countPhrases(edited, WARM_PHRASES);
  if (editWarm > origWarm) labels.push("add_warmth");
  if (origWarm > editWarm) labels.push("remove_warmth");

  // Tone strength
  const origFirm = countPhrases(original, FIRM_PHRASES);
  const editFirm = countPhrases(edited, FIRM_PHRASES);
  if (editFirm > origFirm) labels.push("strengthen_tone");
  if (origFirm > editFirm) labels.push("soften_tone");

  // Deadlines
  const origHasDeadline = DEADLINE_REGEX.test(original);
  const editHasDeadline = DEADLINE_REGEX.test(edited);
  if (!origHasDeadline && editHasDeadline) labels.push("add_deadline");
  if (origHasDeadline && !editHasDeadline) labels.push("remove_deadline");

  // Call to action
  const origCta = countPhrases(original, CTA_PHRASES);
  const editCta = countPhrases(edited, CTA_PHRASES);
  if (editCta > origCta) labels.push("add_call_to_action");
  if (origCta > editCta) labels.push("remove_call_to_action");

  // Relationship context
  const origRel = countPhrases(original, RELATIONSHIP_PHRASES);
  const editRel = countPhrases(edited, RELATIONSHIP_PHRASES);
  if (editRel > origRel) labels.push("add_relationship_context");
  if (origRel > editRel) labels.push("remove_relationship_context");

  // Greeting / closing changes (compare first / last lines)
  const origLines = original.split("\n").filter((l) => l.trim().length > 0);
  const editLines = edited.split("\n").filter((l) => l.trim().length > 0);
  if (origLines.length > 0 && editLines.length > 0 && origLines[0] !== editLines[0]) {
    labels.push("change_greeting");
  }
  if (origLines.length > 0 && editLines.length > 0) {
    const origLast = origLines[origLines.length - 1];
    const editLast = editLines[editLines.length - 1];
    if (origLast !== editLast) labels.push("change_closing");
  }

  if (labels.length === 0) labels.push("other");
  return labels;
}
