import type { ProjectionBuilder } from "@llm-feedback-middleware/core";

export interface ApprovalRateState {
  /** Total events for the (producer, task_type) so far. */
  total: number;
  /** Events that resolved the artifact (any approve/edit/reject/expired). */
  resolved: number;
  /** Approves-as-is (gold-quality outputs). */
  approved: number;
  /** Rejects + edits + expired. */
  negative: number;
  /**
   * Computed at write time so consumers can read it directly without re-deriving.
   * `approved / resolved` (NaN if resolved == 0).
   */
  approvalRate: number;
}

/**
 * Reference projection: tracks approval rate per (producer, task_type).
 *
 * Increment-only counters with a derived rate. Sync-mode by default; switch
 * to async if your consumer doesn't need the rate immediately after capture.
 */
export const approvalRateProjection: ProjectionBuilder<ApprovalRateState> = {
  name: "approval_rate",
  mode: "sync",
  applies: (event) =>
    event.action === "approve" ||
    event.action === "edit" ||
    event.action === "reject" ||
    event.action === "expired",
  keyFor: (event) => `${event.producer}::${event.task_type}`,
  apply: (event, current) => {
    const prev = current ?? { total: 0, resolved: 0, approved: 0, negative: 0, approvalRate: 0 };
    const total = prev.total + 1;
    const resolved = prev.resolved + 1;
    const approved = prev.approved + (event.action === "approve" ? 1 : 0);
    const negative = prev.negative + (event.action !== "approve" ? 1 : 0);
    const approvalRate = resolved === 0 ? 0 : approved / resolved;
    return { total, resolved, approved, negative, approvalRate };
  },
};
