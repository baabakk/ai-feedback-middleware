import type {
  ClaimDueWaitingInput,
  TrackedArtifactRow,
  TrackedArtifactStatus,
  TrackedArtifactsPort,
} from "@ai-feedback-middleware/core";

export interface InMemoryTrackedArtifactsOptions {
  /** Optional initial rows (useful for tests). */
  seed?: TrackedArtifactRow[];
}

export function createInMemoryTrackedArtifactsStore(
  options: InMemoryTrackedArtifactsOptions = {},
): TrackedArtifactsPort {
  const rows = new Map<string, TrackedArtifactRow>();
  for (const r of options.seed ?? []) {
    rows.set(r.artifact_id, { ...r });
  }

  return {
    async insertWaiting(row: TrackedArtifactRow): Promise<void> {
      if (rows.has(row.artifact_id)) {
        throw new Error(
          `tracked_artifacts: artifact_id=${row.artifact_id} already exists. ` +
            `captureArtifact should be called once per artifact_id.`,
        );
      }
      rows.set(row.artifact_id, { ...row });
    },

    async getByArtifactId(artifact_id: string): Promise<TrackedArtifactRow | null> {
      const row = rows.get(artifact_id);
      return row ? { ...row } : null;
    },

    async markTerminal(
      artifact_id: string,
      status: Exclude<TrackedArtifactStatus, "waiting">,
      terminal_reaction_event_id: string,
      terminal_status_at: string,
    ): Promise<void> {
      const row = rows.get(artifact_id);
      if (!row) return;
      // Idempotent: skip if already terminal.
      if (row.status !== "waiting") return;
      row.status = status;
      row.terminal_status_at = terminal_status_at;
      row.terminal_reaction_event_id = terminal_reaction_event_id;
    },

    async claimDueWaiting(input: ClaimDueWaitingInput): Promise<TrackedArtifactRow[]> {
      const nowMs = Date.parse(input.now);
      const claimed: TrackedArtifactRow[] = [];
      for (const row of rows.values()) {
        if (claimed.length >= input.limit) break;
        if (row.status !== "waiting") continue;
        if (Date.parse(row.expires_at) > nowMs) continue;
        const leaseUntil = row.lease_until ? Date.parse(row.lease_until) : 0;
        if (leaseUntil > nowMs) continue;
        row.lease_owner = input.leaseOwner;
        row.lease_until = new Date(nowMs + input.leaseForSeconds * 1000).toISOString();
        row.last_checked_at = input.now;
        claimed.push({ ...row });
      }
      return claimed;
    },

    async countByStatus(): Promise<Partial<Record<TrackedArtifactStatus, number>>> {
      const counts: Partial<Record<TrackedArtifactStatus, number>> = {};
      for (const row of rows.values()) {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
      }
      return counts;
    },
  };
}
