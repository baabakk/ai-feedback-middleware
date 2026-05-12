import type { ProjectionBuilder } from "@ai-feedback-middleware/core";

export interface ApprovalRateState {
  /** Total reactions for the (producer, task_type) so far. */
  total: number;
  /** Reactions that resolved an artifact's lifecycle (terminal reactions). */
  resolved: number;
  /** Approves-as-is (gold-quality outputs). */
  approved: number;
  /** All non-approved terminal reactions. */
  negative: number;
  /**
   * Computed at write time so consumers can read it directly without re-deriving.
   * `approved / resolved` (0 if resolved == 0).
   */
  approvalRate: number;
}

const TERMINAL_ACTIONS = new Set([
  "approved",
  "manually_edited",
  "rejected",
  "regenerated",
  "not_selected_from_list",
  "mute_triggered",
  "manually_replaced",
  "internally_unobserved_externally_completed",
  "silently_accepted",
  "silently_rejected_expired",
]);

/**
 * Reference projection: tracks approval rate per (producer, task_type).
 *
 * Increment-only counters with a derived rate. Sync-mode by default; switch
 * to async if your consumer doesn't need the rate immediately after capture.
 *
 * v2.1: keys off the new past-tense action vocabulary. Tombstones
 * (`cancelled`, `corrected`, `superseded_by`) are excluded from the rate.
 */
export const approvalRateProjection: ProjectionBuilder<ApprovalRateState> = {
  name: "approval_rate",
  mode: "sync",
  applies: (event) =>
    event.event_kind === "reaction" && TERMINAL_ACTIONS.has(event.action),
  keyFor: (event) => `${event.producer}::${event.task_type}`,
  apply: (event, current) => {
    const prev = current ?? { total: 0, resolved: 0, approved: 0, negative: 0, approvalRate: 0 };
    const total = prev.total + 1;
    const resolved = prev.resolved + 1;
    const reaction = event as Extract<typeof event, { event_kind: "reaction" }>;
    const isApproved = reaction.action === "approved" || reaction.action === "silently_accepted";
    const approved = prev.approved + (isApproved ? 1 : 0);
    const negative = prev.negative + (isApproved ? 0 : 1);
    const approvalRate = resolved === 0 ? 0 : approved / resolved;
    return { total, resolved, approved, negative, approvalRate };
  },
};
