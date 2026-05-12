import type { Pool, PoolClient } from "pg";
import type {
  ClaimDueWaitingInput,
  TrackedArtifactRow,
  TrackedArtifactStatus,
  TrackedArtifactsPort,
  Transaction,
} from "@ai-feedback-middleware/core";

export interface PostgresTrackedArtifactsOptions {
  pool: Pool;
  /** Override the table name (default: `tracked_artifacts`). */
  tableName?: string;
}

interface DbRow {
  artifact_id: string;
  artifact_type: string;
  artifact_version: number;
  partition_key: string;
  producer: string;
  task_type: string;
  status: TrackedArtifactStatus;
  expires_at: Date;
  created_at: Date;
  terminal_status_at: Date | null;
  terminal_reaction_event_id: string | null;
  last_checked_at: Date | null;
  lease_owner: string | null;
  lease_until: Date | null;
}

function rowToRecord(r: DbRow): TrackedArtifactRow {
  const out: TrackedArtifactRow = {
    artifact_id: r.artifact_id,
    artifact_type: r.artifact_type,
    artifact_version: r.artifact_version,
    partition_key: r.partition_key,
    producer: r.producer,
    task_type: r.task_type,
    status: r.status,
    expires_at: r.expires_at.toISOString(),
    created_at: r.created_at.toISOString(),
  };
  if (r.terminal_status_at !== null) out.terminal_status_at = r.terminal_status_at.toISOString();
  if (r.terminal_reaction_event_id !== null) {
    out.terminal_reaction_event_id = r.terminal_reaction_event_id;
  }
  if (r.last_checked_at !== null) out.last_checked_at = r.last_checked_at.toISOString();
  if (r.lease_owner !== null) out.lease_owner = r.lease_owner;
  if (r.lease_until !== null) out.lease_until = r.lease_until.toISOString();
  return out;
}

export function createPostgresTrackedArtifactsStore(
  options: PostgresTrackedArtifactsOptions,
): TrackedArtifactsPort {
  const pool = options.pool;
  const table = options.tableName ?? "tracked_artifacts";

  function executor(tx?: Transaction): Pool | PoolClient {
    return (tx ?? pool) as Pool | PoolClient;
  }

  return {
    async insertWaiting(row: TrackedArtifactRow, tx?: Transaction): Promise<void> {
      await executor(tx).query(
        `INSERT INTO ${table} (
          artifact_id, artifact_type, artifact_version, partition_key,
          producer, task_type, status, expires_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          row.artifact_id,
          row.artifact_type,
          row.artifact_version,
          row.partition_key,
          row.producer,
          row.task_type,
          row.status,
          row.expires_at,
          row.created_at,
        ],
      );
    },

    async getByArtifactId(artifact_id: string): Promise<TrackedArtifactRow | null> {
      const result = await pool.query<DbRow>(`SELECT * FROM ${table} WHERE artifact_id = $1`, [
        artifact_id,
      ]);
      return result.rows[0] ? rowToRecord(result.rows[0]) : null;
    },

    async markTerminal(
      artifact_id: string,
      status: Exclude<TrackedArtifactStatus, "waiting">,
      terminal_reaction_event_id: string,
      terminal_status_at: string,
      tx?: Transaction,
    ): Promise<void> {
      await executor(tx).query(
        `UPDATE ${table}
         SET status = $2,
             terminal_status_at = $3,
             terminal_reaction_event_id = $4
         WHERE artifact_id = $1 AND status = 'waiting'`,
        [artifact_id, status, terminal_status_at, terminal_reaction_event_id],
      );
    },

    async claimDueWaiting(input: ClaimDueWaitingInput): Promise<TrackedArtifactRow[]> {
      const result = await pool.query<DbRow>(
        `WITH due AS (
           SELECT artifact_id FROM ${table}
           WHERE status = 'waiting'
             AND expires_at <= $1::timestamptz
             AND (lease_until IS NULL OR lease_until < $1::timestamptz)
           ORDER BY expires_at ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE ${table} t
         SET lease_owner = $3,
             lease_until = ($1::timestamptz + make_interval(secs => $4::float8)),
             last_checked_at = $1::timestamptz
         FROM due
         WHERE t.artifact_id = due.artifact_id
         RETURNING t.*`,
        [input.now, input.limit, input.leaseOwner, input.leaseForSeconds],
      );
      return result.rows.map(rowToRecord);
    },

    async countByStatus(): Promise<Partial<Record<TrackedArtifactStatus, number>>> {
      const result = await pool.query<{ status: TrackedArtifactStatus; c: string }>(
        `SELECT status, COUNT(*)::text AS c FROM ${table} GROUP BY status`,
      );
      const counts: Partial<Record<TrackedArtifactStatus, number>> = {};
      for (const r of result.rows) counts[r.status] = parseInt(r.c, 10);
      return counts;
    },
  };
}
