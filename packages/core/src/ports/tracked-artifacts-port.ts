import type { Transaction } from "./event-store-port.js";

/**
 * Mutable lifecycle state for governed artifacts. The only persistently
 * mutable per-artifact state in the framework — everything else is immutable
 * append-only events.
 *
 * Status transitions:
 *   waiting
 *     ├─ reacted                       (terminal user-driven reaction)
 *     ├─ silently_accepted             (deadline + accepted_by_default policy)
 *     ├─ silently_rejected_expired     (deadline + rejected_by_default policy)
 *     ├─ cancelled                     (cancelled tombstone)
 *     └─ superseded                    (superseded_by tombstone)
 *
 * See spec §9.2 and architecture §34 (Lifecycle row).
 */
export type TrackedArtifactStatus =
  | "waiting"
  | "reacted"
  | "silently_accepted"
  | "silently_rejected_expired"
  | "cancelled"
  | "superseded";

export interface TrackedArtifactRow {
  artifact_id: string;
  artifact_type: string;
  /**
   * Denormalized from the captured_artifacts row so reactions don't have to
   * round-trip through the event store to find the artifact's owning
   * producer / partition / task. Set once on insertWaiting; never mutated.
   */
  artifact_version: number;
  partition_key: string;
  producer: string;
  task_type: string;

  status: TrackedArtifactStatus;
  expires_at: string;
  created_at: string;

  terminal_status_at?: string;
  terminal_reaction_event_id?: string;

  last_checked_at?: string;
  lease_owner?: string;
  lease_until?: string;
}

export interface ClaimDueWaitingInput {
  now: string;
  leaseOwner: string;
  leaseForSeconds: number;
  limit: number;
}

/**
 * Storage for the mutable lifecycle row. Read by the Lifecycle Worker
 * (Layer 2) and by the artifact-progress views.
 */
export interface TrackedArtifactsPort {
  /** Insert a new row at status='waiting'. Joins the enclosing transaction. */
  insertWaiting(row: TrackedArtifactRow, tx?: Transaction): Promise<void>;

  /** Look up the current row by artifact_id. */
  getByArtifactId(artifact_id: string): Promise<TrackedArtifactRow | null>;

  /**
   * Atomically transition a row from 'waiting' (or any non-terminal state)
   * to a terminal status. Idempotent: a no-op if already terminal.
   */
  markTerminal(
    artifact_id: string,
    status: Exclude<TrackedArtifactStatus, "waiting">,
    terminal_reaction_event_id: string,
    terminal_status_at: string,
    tx?: Transaction,
  ): Promise<void>;

  /**
   * Lease-based claim of due-waiting rows. Returns up to `limit` rows whose
   * `expires_at <= now` and whose `lease_until < now` (or null), with the
   * lease updated to `now + leaseForSeconds` and `lease_owner` set. The
   * Lifecycle Worker calls this each tick; multiple workers can coexist
   * because the claim is atomic per row.
   */
  claimDueWaiting(input: ClaimDueWaitingInput): Promise<TrackedArtifactRow[]>;

  /** For dashboards / observability. */
  countByStatus(): Promise<Partial<Record<TrackedArtifactStatus, number>>>;
}
