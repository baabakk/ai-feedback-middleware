import type { ActionabilityDecision } from "../inference-engine.js";
import type { ActionabilityFilter } from "../event-types.js";
import type { Transaction } from "./event-store-port.js";

/**
 * Storage for {@link ActionabilityDecision} rows produced by Layer 4
 * (Actionable Result Inference). Append-only — old decisions are historical
 * fact and never mutate.
 *
 * `appendBatch` participates in the enclosing transaction so a recordReaction
 * call writes its inline-computed decisions atomically with the reaction
 * event itself.
 *
 * See spec §9.1 (table) and §12 (Layer 4 semantics).
 */
export interface ActionabilityDecisionsStore {
  /** Append a batch of decisions atomically. May join an enclosing tx. */
  appendBatch(decisions: ActionabilityDecision[], tx?: Transaction): Promise<void>;

  /** Iterate decisions matching the filter. Used by `readActionableDecisions`. */
  read(filter?: ActionabilityFilter): AsyncIterable<ActionabilityDecision>;
}
